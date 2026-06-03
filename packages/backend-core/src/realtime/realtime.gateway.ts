import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { schema, type Db } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  CredentialResolver,
  WebhookDispatcher,
  withContext,
  type RequestContext,
  type ResolvedCredential,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { DB } from '../common/db/db.module.ts';
import { toIsoString } from '../common/iso.ts';
import {
  ADDITIONAL_CREDENTIAL_RESOLVERS,
  type AdditionalCredentialResolver,
} from '../common/auth/auth.guard.ts';
import { DbListenerService, type EventRow } from './db-listener.service.ts';
import { RealtimeEventBus, type AgentTypingBusEvent } from './realtime-event-bus.ts';
import {
  enforceOriginAllowlist,
  verifyIdentity,
} from '../modules/conv/widget/widget-ingest.service.ts';
import { WidgetChannelConfig } from '../modules/conv/widget/widget.types.ts';
import { readAllowedOrigins } from '../bootstrap-app.ts';

const PATH = '/v1/realtime';

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'typing' | 'read';
  channel?: 'org' | 'conversation' | 'contact' | 'widget';
  id?: string;
  channelId?: string;
  sessionId?: string;
  isTyping?: boolean;
  messageIds?: string[];
}

interface WidgetConnectionContext {
  channelId: string;
  verifiedExternalId?: string;
}

interface ConversationMetaCache {
  meta: { channelId: string; sessionId: string | null; contactExternalId: string | null } | null;
}

interface ConnectionEntry {
  ws: WebSocket;
  widgetCtx: WidgetConnectionContext | null;
  orgId: string;
  conversationMetaCache: Map<string, ConversationMetaCache>;
  typingLastFiredAt: Map<string, number>;
  typingAutoClearTimers: Map<string, NodeJS.Timeout>;
}

const TYPING_MIN_INTERVAL_MS = 1500;
const TYPING_AUTO_CLEAR_MS = 5000;
const WS_MAX_PAYLOAD_BYTES = 64 * 1024;

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;
  private upgradeListener: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;
  private readonly resolver: CredentialResolver;
  private readonly selfServiceSubscribersByOrg = new Map<string, Set<WebSocket>>();
  private readonly subscribersByChannel = new Map<string, Set<ConnectionEntry>>();
  private busTypingUnsubscribe: (() => void) | null = null;

  selfServiceSubscriberCount(orgId: string): number {
    return this.selfServiceSubscribersByOrg.get(orgId)?.size ?? 0;
  }

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly listener: DbListenerService,
    private readonly bus: RealtimeEventBus,
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Optional()
    @Inject(ADDITIONAL_CREDENTIAL_RESOLVERS)
    private readonly additionalResolvers: AdditionalCredentialResolver[] = [],
  ) {
    this.resolver = new CredentialResolver(db);
  }

  onApplicationBootstrap(): void {
    if (process.env.MUNIN_REALTIME_DISABLED === '1') {
      this.logger.log('realtime gateway disabled via MUNIN_REALTIME_DISABLED');
      return;
    }
    const httpServer = this.adapterHost.httpAdapter.getHttpServer() as HttpServer | null;
    if (!httpServer) {
      this.logger.warn('http server not available; realtime gateway inactive');
      return;
    }

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: WS_MAX_PAYLOAD_BYTES,
      handleProtocols: (protocols) => {
        if (protocols.has('bearer')) return 'bearer';
        return false;
      },
    });
    const listener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url || !req.url.startsWith(PATH)) return;
      this.handleUpgrade(req, socket, head).catch((err: unknown) => {
        this.logger.warn(`handleUpgrade failed: ${describeError(err)}`);
        try {
          socket.destroy();
        } catch (destroyErr) {
          this.logger.debug?.(`socket destroy after upgrade failure raised: ${describeError(destroyErr)}`);
        }
      });
    };
    this.upgradeListener = listener;
    httpServer.on('upgrade', listener);
    this.busTypingUnsubscribe = this.bus.subscribeAgentTyping((event) => {
      this.handleBusAgentTyping(event).catch((err: unknown) =>
        this.logger.warn(`bus typing dispatch failed: ${describeError(err)}`),
      );
    });
    this.logger.log(`gateway listening on ${PATH}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.busTypingUnsubscribe) {
      this.busTypingUnsubscribe();
      this.busTypingUnsubscribe = null;
    }
    if (this.wss) {
      this.wss.clients.forEach((c) => c.terminate());
      await new Promise<void>((resolve) =>
        this.wss!.close(() => resolve()),
      );
      this.wss = null;
    }
    this.selfServiceSubscribersByOrg.clear();
  }

  private async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let authResult: { credential: ResolvedCredential; fromCookie: boolean } | null = null;
    try {
      authResult = await this.authenticate(req);
    } catch (err) {
      this.logger.debug(`upgrade auth failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!authResult) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const credential = authResult.credential;

    if (authResult.fromCookie && !isOriginAllowedForCookieAuth(readHeader(req, 'origin'))) {
      this.logger.debug('upgrade rejected: cookie-authed WS origin not in allowlist');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    let widgetCtx: WidgetConnectionContext | null = null;
    try {
      widgetCtx = await this.gateWidgetUpgrade(req, credential);
    } catch (err) {
      this.logger.debug(`widget upgrade gate failed: ${describeErr(err)}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!this.wss) {
      socket.destroy();
      return;
    }
    const resolvedCredential = credential;
    const widgetContext = widgetCtx;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleConnection(ws, resolvedCredential, widgetContext);
    });
  }

  private async gateWidgetUpgrade(
    req: IncomingMessage,
    credential: ResolvedCredential,
  ): Promise<WidgetConnectionContext | null> {
    const apiKey = await this.db
      .select({ type: schema.apiKeys.type, channelId: schema.apiKeys.channelId })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, credential.actor.id))
      .limit(1);
    const row = apiKey[0];
    if (!row || row.type !== 'widget') return null;
    if (!row.channelId) throw new Error('widget_key_missing_channel');

    const channelRows = await this.db
      .select({
        config: schema.convChannels.config,
        active: schema.convChannels.active,
      })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, row.channelId))
      .limit(1);
    const channelRow = channelRows[0];
    if (!channelRow) throw new Error('widget_channel_not_found');
    if (!channelRow.active) throw new Error('widget_channel_inactive');
    const config = WidgetChannelConfig.parse(channelRow.config);

    const origin = readHeader(req, 'origin');
    enforceOriginAllowlist(config, origin);

    const url = new URL(req.url ?? '/', 'http://localhost');
    const verifiedExternalId = url.searchParams.get('externalId') ?? undefined;
    const userHash = url.searchParams.get('userHash') ?? undefined;
    const identity = verifyIdentity(config, { verifiedExternalId, userHash });

    return {
      channelId: row.channelId,
      verifiedExternalId: identity.mode === 'verified' ? identity.externalId : undefined,
    };
  }

  private handleConnection(
    ws: WebSocket,
    credential: ResolvedCredential,
    widgetCtx: WidgetConnectionContext | null,
  ): void {
    const actor = credential.actor;
    const subscriptions = new Set<string>();
    const conversationMetaCache = new Map<string, ConversationMetaCache>();
    const isWidget = !!widgetCtx;
    const entry: ConnectionEntry = {
      ws,
      widgetCtx,
      orgId: actor.orgId,
      conversationMetaCache,
      typingLastFiredAt: new Map(),
      typingAutoClearTimers: new Map(),
    };
    const isSelfServiceAgent = !isWidget && actor.type !== 'end_user_agent';
    if (isSelfServiceAgent) {
      let set = this.selfServiceSubscribersByOrg.get(actor.orgId);
      if (!set) {
        set = new Set();
        this.selfServiceSubscribersByOrg.set(actor.orgId, set);
      }
      set.add(ws);
    }
    const removeSelfServiceSubscriber = () => {
      if (!isSelfServiceAgent) return;
      const set = this.selfServiceSubscribersByOrg.get(actor.orgId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) this.selfServiceSubscribersByOrg.delete(actor.orgId);
    };

    const addChannelSubscription = (key: string) => {
      subscriptions.add(key);
      let set = this.subscribersByChannel.get(key);
      if (!set) {
        set = new Set();
        this.subscribersByChannel.set(key, set);
      }
      set.add(entry);
    };
    const removeChannelSubscription = (key: string) => {
      subscriptions.delete(key);
      const set = this.subscribersByChannel.get(key);
      if (!set) return;
      set.delete(entry);
      if (set.size === 0) this.subscribersByChannel.delete(key);
    };
    const removeAllChannelSubscriptions = () => {
      for (const key of subscriptions) {
        const set = this.subscribersByChannel.get(key);
        if (!set) continue;
        set.delete(entry);
        if (set.size === 0) this.subscribersByChannel.delete(key);
      }
      subscriptions.clear();
    };
    const clearTypingTimers = () => {
      for (const t of entry.typingAutoClearTimers.values()) clearTimeout(t);
      entry.typingAutoClearTimers.clear();
      entry.typingLastFiredAt.clear();
    };

    const unsubscribe = this.listener.subscribe((event) => {
      if (event.org_id !== actor.orgId) return;
      for (const channel of subscriptions) {
        if (isWidget) {
          void this.matchWidgetEvent(channel, event, conversationMetaCache, widgetCtx).then(
            (matched) => {
              if (matched) ws.send(JSON.stringify({ type: 'event', channel, event }));
            },
          );
        } else if (channelMatches(channel, event)) {
          ws.send(JSON.stringify({ type: 'event', channel, event }));
        }
      }
    });

    ws.on('message', (data) => {
      let msg: ClientMessage | null = null;
      try {
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8');
        msg = JSON.parse(text) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (msg.type === 'typing') {
        this.handleTyping(entry, msg).catch((err: unknown) =>
          this.logger.warn(`handleTyping failed: ${describeError(err)}`),
        );
        return;
      }
      if (msg.type === 'read') {
        this.handleRead(entry, msg).catch((err: unknown) =>
          this.logger.warn(`handleRead failed: ${describeError(err)}`),
        );
        return;
      }
      const key = encodeChannel(msg);
      if (!key) return;
      if (isWidget) {
        if (!key.startsWith(`widget:${widgetCtx.channelId}:`)) return;
      }
      if (msg.type === 'subscribe') {
        if (isWidget) {
          addChannelSubscription(key);
        } else {
          this.allowSubscription(actor, key)
            .then((allowed) => {
              if (allowed) addChannelSubscription(key);
            })
            .catch((err: unknown) =>
              this.logger.warn(`subscription gate failed: ${describeError(err)}`),
            );
        }
      } else if (msg.type === 'unsubscribe') {
        removeChannelSubscription(key);
      }
    });

    ws.on('close', () => {
      unsubscribe();
      removeSelfServiceSubscriber();
      removeAllChannelSubscriptions();
      clearTypingTimers();
    });
    ws.on('error', () => {
      unsubscribe();
      removeSelfServiceSubscriber();
      removeAllChannelSubscriptions();
      clearTypingTimers();
    });

    ws.send(JSON.stringify({ type: 'ready', orgId: actor.orgId }));
  }

  private async handleTyping(entry: ConnectionEntry, msg: ClientMessage): Promise<void> {
    if (typeof msg.isTyping !== 'boolean') return;
    const isWidget = !!entry.widgetCtx;

    let conversationId: string | null = null;
    let outboundChannel: string | null = null;
    let authorType: 'visitor' | 'operator' | null = null;

    if (msg.channel === 'widget') {
      if (!isWidget) return;
      if (!msg.channelId || !msg.sessionId) return;
      if (msg.channelId !== entry.widgetCtx!.channelId) return;
      const meta = await this.resolveWidgetSession(msg.channelId, msg.sessionId);
      if (!meta) return;
      if (
        entry.widgetCtx!.verifiedExternalId &&
        meta.contactExternalId !== entry.widgetCtx!.verifiedExternalId
      ) {
        return;
      }
      conversationId = meta.conversationId;
      outboundChannel = `conversation:${conversationId}`;
      authorType = 'visitor';
    } else if (msg.channel === 'conversation') {
      if (isWidget) return;
      if (!msg.id) return;
      const meta = await this.resolveConversationMeta(msg.id);
      if (!meta || meta.sessionId === null) return;
      conversationId = msg.id;
      outboundChannel = `widget:${meta.channelId}:${meta.sessionId}`;
      authorType = 'operator';
    } else {
      return;
    }

    if (msg.isTyping) {
      const now = Date.now();
      const last = entry.typingLastFiredAt.get(conversationId) ?? 0;
      if (now - last < TYPING_MIN_INTERVAL_MS) return;
      entry.typingLastFiredAt.set(conversationId, now);
    } else {
      entry.typingLastFiredAt.delete(conversationId);
    }

    const existing = entry.typingAutoClearTimers.get(conversationId);
    if (existing) {
      clearTimeout(existing);
      entry.typingAutoClearTimers.delete(conversationId);
    }

    this.fanoutTyping(entry, outboundChannel, conversationId, authorType, msg.isTyping);

    if (msg.isTyping) {
      const conversationIdSnapshot = conversationId;
      const outboundChannelSnapshot = outboundChannel;
      const authorTypeSnapshot = authorType;
      const timer = setTimeout(() => {
        entry.typingAutoClearTimers.delete(conversationIdSnapshot);
        entry.typingLastFiredAt.delete(conversationIdSnapshot);
        this.fanoutTyping(
          entry,
          outboundChannelSnapshot,
          conversationIdSnapshot,
          authorTypeSnapshot,
          false,
        );
      }, TYPING_AUTO_CLEAR_MS);
      entry.typingAutoClearTimers.set(conversationId, timer);
    }
  }

  private async handleRead(entry: ConnectionEntry, msg: ClientMessage): Promise<void> {
    if (!entry.widgetCtx) return;
    if (msg.channel !== 'widget') return;
    if (!msg.channelId || !msg.sessionId) return;
    if (msg.channelId !== entry.widgetCtx.channelId) return;
    if (!Array.isArray(msg.messageIds) || msg.messageIds.length === 0) return;
    const messageIds = msg.messageIds.filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (messageIds.length === 0) return;

    const meta = await this.resolveWidgetSession(msg.channelId, msg.sessionId);
    if (!meta) return;
    if (
      entry.widgetCtx.verifiedExternalId &&
      meta.contactExternalId !== entry.widgetCtx.verifiedExternalId
    ) {
      return;
    }
    const conversationId = meta.conversationId;

    const conv = await this.db
      .select({
        orgId: schema.convConversations.orgId,
        endUserId: schema.convConversations.endUserId,
      })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    const convRow = conv[0];
    if (!convRow || !convRow.endUserId) return;
    if (convRow.orgId !== entry.orgId) return;

    const messageIdList = sql.join(
      messageIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const inserted = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${convRow.orgId}, true)`);
      return tx.execute<{ message_id: string; read_at: Date | string }>(sql`
        INSERT INTO conv_message_reads (id, org_id, conversation_id, message_id, end_user_id, read_at)
        SELECT
          'cmr_' || encode(gen_random_bytes(16), 'hex'),
          ${convRow.orgId},
          ${conversationId},
          m.id,
          ${convRow.endUserId},
          NOW()
        FROM conv_messages m
        WHERE m.id IN (${messageIdList})
          AND m.conversation_id = ${conversationId}
          AND m.author_type <> 'end_user'
        ON CONFLICT (message_id, end_user_id) DO NOTHING
        RETURNING message_id, read_at
      `);
    });

    const rows: { message_id: string; read_at: Date | string }[] = Array.isArray(inserted)
      ? (inserted as { message_id: string; read_at: Date | string }[])
      : ((inserted as { rows?: { message_id: string; read_at: Date | string }[] }).rows ?? []);

    if (entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(
        JSON.stringify({
          type: 'read_ack',
          conversationId,
          messageIds: rows.map((r) => r.message_id),
        }),
      );
    }

    if (rows.length === 0) return;

    const actor = new ActorIdentity(
      'system',
      'widget-read-tracker',
      convRow.orgId,
      ['*'],
      ['admin'],
    );
    const ctx: RequestContext = {
      db: this.db,
      actor,
      correlationId: randomUUID(),
    };
    await withContext(ctx, async () => {
      for (const row of rows) {
        try {
          await this.webhooks.emit({
            type: 'conversation.message.read',
            payload: {
              conversationId,
              messageId: row.message_id,
              endUserId: convRow.endUserId,
              readAt: toIsoString(row.read_at),
            },
          });
        } catch (err) {
          this.logger.warn(
            `conversation.message.read webhook emit failed for ${row.message_id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  }

  private async handleBusAgentTyping(event: AgentTypingBusEvent): Promise<void> {
    const meta = await this.resolveConversationMeta(event.conversationId);
    if (!meta || meta.sessionId === null) return;
    const outboundChannel = `widget:${meta.channelId}:${meta.sessionId}`;
    const subs = this.subscribersByChannel.get(outboundChannel);
    if (!subs) return;
    const payload = JSON.stringify({
      type: 'typing',
      channel: outboundChannel,
      isTyping: event.isTyping,
      authorType: 'operator',
    });
    for (const sub of subs) {
      if (sub.orgId !== event.orgId) continue;
      if (sub.widgetCtx?.verifiedExternalId) {
        const cached = sub.conversationMetaCache.get(event.conversationId);
        if (
          !cached ||
          !cached.meta ||
          cached.meta.contactExternalId !== sub.widgetCtx.verifiedExternalId
        ) {
          void this.resolveConversationMeta(event.conversationId).then((resolved) => {
            sub.conversationMetaCache.set(event.conversationId, { meta: resolved });
          });
          continue;
        }
      }
      try {
        sub.ws.send(payload);
      } catch (err) {
        this.logger.debug?.(`fanoutTyping send failed (socket likely mid-close): ${describeError(err)}`);
      }
    }
  }

  private fanoutTyping(
    fromEntry: ConnectionEntry,
    outboundChannel: string,
    conversationId: string,
    authorType: 'visitor' | 'operator',
    isTyping: boolean,
  ): void {
    const subs = this.subscribersByChannel.get(outboundChannel);
    if (!subs) return;
    const payload = JSON.stringify({
      type: 'typing',
      channel: outboundChannel,
      isTyping,
      authorType,
    });
    for (const sub of subs) {
      if (sub === fromEntry) continue;
      if (sub.orgId !== fromEntry.orgId) continue;
      if (sub.widgetCtx?.verifiedExternalId) {
        const cached = sub.conversationMetaCache.get(conversationId);
        if (
          !cached ||
          !cached.meta ||
          cached.meta.contactExternalId !== sub.widgetCtx.verifiedExternalId
        ) {
          void this.resolveConversationMeta(conversationId).then((meta) => {
            sub.conversationMetaCache.set(conversationId, { meta });
          });
          continue;
        }
      }
      try {
        sub.ws.send(payload);
      } catch (err) {
        this.logger.debug?.(`bus typing send failed (socket likely mid-close): ${describeError(err)}`);
      }
    }
  }

  private async resolveWidgetSession(
    channelId: string,
    sessionId: string,
  ): Promise<{ conversationId: string; contactExternalId: string | null } | null> {
    const rows = await this.db
      .select({
        id: schema.convConversations.id,
        contactExternalId: sql<string | null>`${schema.convContacts.metadata}->>'externalId'`,
      })
      .from(schema.convConversations)
      .leftJoin(
        schema.convContacts,
        eq(schema.convContacts.id, schema.convConversations.contactId),
      )
      .where(
        sql`${schema.convConversations.channelId} = ${channelId} AND ${schema.convConversations.metadata}->>'sessionId' = ${sessionId}`,
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { conversationId: row.id, contactExternalId: row.contactExternalId ?? null };
  }

  private async matchWidgetEvent(
    channel: string,
    event: EventRow,
    cache: Map<string, ConversationMetaCache>,
    widgetCtx: WidgetConnectionContext,
  ): Promise<boolean> {
    if (!channel.startsWith('widget:')) return false;
    const rest = channel.slice('widget:'.length);
    const sep = rest.indexOf(':');
    if (sep < 0) return false;
    const subChannelId = rest.slice(0, sep);
    const subSessionId = rest.slice(sep + 1);
    if (subChannelId !== widgetCtx.channelId) return false;

    const conversationId = event.payload?.['conversationId'];
    if (typeof conversationId !== 'string') return false;

    let cached = cache.get(conversationId);
    if (!cached) {
      const meta = await this.resolveConversationMeta(conversationId);
      cached = { meta };
      cache.set(conversationId, cached);
    }
    const meta = cached.meta;
    if (!meta) return false;
    if (meta.channelId !== subChannelId) return false;
    if (meta.sessionId !== subSessionId) return false;
    if (widgetCtx.verifiedExternalId) {
      if (meta.contactExternalId !== widgetCtx.verifiedExternalId) return false;
    }
    return true;
  }

  private async resolveConversationMeta(
    conversationId: string,
  ): Promise<{ channelId: string; sessionId: string | null; contactExternalId: string | null } | null> {
    const rows = await this.db
      .select({
        channelId: schema.convConversations.channelId,
        sessionId: sql<string | null>`${schema.convConversations.metadata}->>'sessionId'`,
        contactExternalId: sql<string | null>`${schema.convContacts.metadata}->>'externalId'`,
      })
      .from(schema.convConversations)
      .leftJoin(
        schema.convContacts,
        eq(schema.convContacts.id, schema.convConversations.contactId),
      )
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (!row.channelId) return null;
    return {
      channelId: row.channelId,
      sessionId: row.sessionId ?? null,
      contactExternalId: row.contactExternalId ?? null,
    };
  }

  private async allowSubscription(actor: ActorIdentity, key: string): Promise<boolean> {
    if (actor.type !== 'end_user_agent') return true;
    if (!actor.endUserId) return false;
    if (key.startsWith('conversation:')) {
      const conversationId = key.slice('conversation:'.length);
      const rows = await this.db
        .select({ endUserId: schema.convConversations.endUserId })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, conversationId))
        .limit(1);
      return rows[0]?.endUserId === actor.endUserId;
    }
    if (key.startsWith('contact:')) {
      const contactId = key.slice('contact:'.length);
      const rows = await this.db
        .select({ endUserId: schema.convContacts.endUserId })
        .from(schema.convContacts)
        .where(eq(schema.convContacts.id, contactId))
        .limit(1);
      return rows[0]?.endUserId === actor.endUserId;
    }
    return false;
  }

  private async authenticate(
    req: IncomingMessage,
  ): Promise<{ credential: ResolvedCredential; fromCookie: boolean } | null> {
    const headerToken = readBearerToken(readHeader(req, 'authorization'));
    if (headerToken) {
      const credential = await this.resolveToken(headerToken);
      return credential ? { credential, fromCookie: false } : null;
    }
    const subprotocolToken = readBearerSubprotocol(readHeader(req, 'sec-websocket-protocol'));
    if (subprotocolToken) {
      const credential = await this.resolveToken(subprotocolToken);
      return credential ? { credential, fromCookie: false } : null;
    }
    const cookieValue = readHeader(req, 'cookie');
    const sessionToken = readSessionCookie(cookieValue);
    if (sessionToken) {
      const credential = await this.resolver.resolveSessionToken(sessionToken);
      return credential ? { credential, fromCookie: true } : null;
    }
    return null;
  }

  private async resolveToken(raw: string): Promise<ResolvedCredential | null> {
    if (raw.startsWith('mn_dlg_')) {
      return this.resolver.resolveBearerToken(raw);
    }
    if (looksLikeApiKey(raw)) {
      let credential = await this.resolver.resolveApiKey(raw);
      if (!credential) {
        for (const extra of this.additionalResolvers) {
          credential = await extra.resolve(raw);
          if (credential) break;
        }
      }
      return credential;
    }
    return this.resolver.resolveBearerToken(raw);
  }
}

const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function readBearerToken(value: string | undefined): string | null {
  if (!value || !value.toLowerCase().startsWith('bearer ')) return null;
  const raw = value.slice('Bearer '.length).trim();
  return raw.length > 0 ? raw : null;
}

export function readBearerSubprotocol(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i]?.toLowerCase() === 'bearer') {
      return parts[i + 1] ?? null;
    }
  }
  return null;
}

function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!SESSION_COOKIE_NAMES.includes(name)) continue;
    const raw = decodeURIComponent(part.slice(eq + 1).trim());
    const dot = raw.indexOf('.');
    return dot >= 0 ? raw.slice(0, dot) : raw;
  }
  return null;
}

function looksLikeApiKey(raw: string): boolean {
  return /^mn_[a-z]+_[A-Za-z0-9_-]+$/.test(raw);
}

export function isOriginAllowedForCookieAuth(origin: string | undefined): boolean {
  if (!origin) return false;
  const allowed = readAllowedOrigins();
  if (allowed === true) return false;
  return allowed.includes(origin);
}

function encodeChannel(msg: ClientMessage): string | null {
  if (msg.channel === 'org') return 'org';
  if (msg.channel === 'conversation' && msg.id) return `conversation:${msg.id}`;
  if (msg.channel === 'contact' && msg.id) return `contact:${msg.id}`;
  if (msg.channel === 'widget' && msg.channelId && msg.sessionId) {
    return `widget:${msg.channelId}:${msg.sessionId}`;
  }
  return null;
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function channelMatches(channel: string, event: EventRow): boolean {
  if (channel === 'org') return true;
  if (channel.startsWith('conversation:')) {
    const id = channel.slice('conversation:'.length);
    return event.payload?.['conversationId'] === id;
  }
  if (channel.startsWith('contact:')) {
    const id = channel.slice('contact:'.length);
    return event.payload?.['contactId'] === id;
  }
  return false;
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== err.message) {
    return `${err.message} (cause: ${cause.message})`;
  }
  return err.message;
}
