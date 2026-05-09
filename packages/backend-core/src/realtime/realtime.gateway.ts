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
import { CredentialResolver, type ResolvedCredential } from '@getmunin/core';
import { DB } from '../common/db/db.module.js';
import {
  ADDITIONAL_CREDENTIAL_RESOLVERS,
  type AdditionalCredentialResolver,
} from '../common/auth/auth.guard.js';
import { DbListenerService, type EventRow } from './db-listener.service.js';
import {
  enforceOriginAllowlist,
  verifyIdentity,
} from '../modules/conv/widget/widget-ingest.service.js';
import { WidgetChannelConfig } from '../modules/conv/widget/widget.types.js';

const PATH = '/api/v1/realtime';

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  channel?: 'org' | 'conversation' | 'contact' | 'widget';
  id?: string;
  /** widget channel: scoped subscription key. */
  channelId?: string;
  sessionId?: string;
}

interface WidgetConnectionContext {
  /** apiKeys.channelId — the widget channel this connection is bound to. */
  channelId: string;
  /** Set iff the upgrade carried a verified identity HMAC. Limits the
   *  connection to events whose conversation contact matches. */
  verifiedExternalId?: string;
}

interface ConversationMetaCache {
  /** null = looked up, not a widget conversation (don't re-query). */
  meta: { channelId: string; sessionId: string | null; contactExternalId: string | null } | null;
}

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;
  private upgradeListener: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;
  private readonly resolver: CredentialResolver;
  private readonly selfServiceSubscribersByOrg = new Map<string, Set<WebSocket>>();

  selfServiceSubscriberCount(orgId: string): number {
    return this.selfServiceSubscribersByOrg.get(orgId)?.size ?? 0;
  }

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly listener: DbListenerService,
    @Inject(DB) private readonly db: Db,
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
      // Browsers can't set arbitrary HTTP headers on a WebSocket upgrade, so
      // browser callers pass the bearer token via Sec-WebSocket-Protocol:
      //   ['bearer', '<token>']  →  send 'bearer' back so the handshake
      // completes. Native (Node ws) callers set the Authorization header and
      // don't offer any subprotocol, so we just decline negotiation.
      handleProtocols: (protocols) => {
        if (protocols.has('bearer')) return 'bearer';
        return false;
      },
    });
    const listener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url || !req.url.startsWith(PATH)) return;
      void this.handleUpgrade(req, socket, head);
    };
    this.upgradeListener = listener;
    httpServer.on('upgrade', listener);
    this.logger.log(`gateway listening on ${PATH}`);
  }

  async onModuleDestroy(): Promise<void> {
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
    let credential: ResolvedCredential | null = null;
    try {
      credential = await this.authenticate(req);
    } catch (err) {
      this.logger.debug(`upgrade auth failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!credential) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Detect a widget API key: look up the apiKeys row and check type.
    // Widget keys carry `channelId` and live behind originAllowlist + HMAC
    // identity gates, so we authorize them at upgrade time before any
    // application data crosses the socket.
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

  /**
   * If `credential` came from a widget API key, validate the upgrade
   * against the channel's `originAllowlist` and `identityVerificationSecret`,
   * and return a context object scoping the connection to that channel.
   * Returns `null` for non-widget credentials. Throws on any widget gate
   * failure so the caller responds with 401.
   */
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
      .select({ config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, row.channelId))
      .limit(1);
    const channelRow = channelRows[0];
    if (!channelRow) throw new Error('widget_channel_not_found');
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
    // Widget connections are visitor-side; they don't count toward the
    // operator self-service subscriber pool.
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

    const unsubscribe = this.listener.subscribe((event) => {
      if (event.org_id !== actor.orgId) return;
      if (
        !isWidget &&
        actor.type === 'end_user_agent' &&
        actor.endUserId &&
        !ownsEvent(event, actor.endUserId)
      ) {
        return;
      }
      for (const channel of subscriptions) {
        if (isWidget) {
          // Widget subscriptions: resolve the event's conversation metadata
          // (cached per-connection) and only forward when the (channelId,
          // sessionId) pair matches AND, in verified mode, the contact's
          // externalId matches the asserted one.
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
      const key = encodeChannel(msg);
      if (!key) return;
      if (isWidget) {
        // Widget keys can ONLY subscribe to their own channelId+sessionId
        // pair. Any attempt to subscribe to org/conversation/contact, or to
        // a different widget channel, is silently ignored — defense in
        // depth alongside the upgrade-time gate.
        if (!key.startsWith(`widget:${widgetCtx!.channelId}:`)) return;
      }
      if (msg.type === 'subscribe') subscriptions.add(key);
      else if (msg.type === 'unsubscribe') subscriptions.delete(key);
    });

    ws.on('close', () => {
      unsubscribe();
      removeSelfServiceSubscriber();
    });
    ws.on('error', () => {
      unsubscribe();
      removeSelfServiceSubscriber();
    });

    ws.send(JSON.stringify({ type: 'ready', orgId: actor.orgId }));
  }

  /**
   * Decide whether an event should be forwarded to a widget subscription
   * `widget:<channelId>:<sessionId>`. Resolves the conversation metadata
   * once per connection per conversationId and caches both hits and
   * non-widget conversations (so we don't re-query for unrelated events).
   */
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

  private async authenticate(req: IncomingMessage): Promise<ResolvedCredential | null> {
    const headerToken = readBearerToken(readHeader(req, 'authorization'));
    if (headerToken) {
      return this.resolveToken(headerToken);
    }
    const subprotocolToken = readBearerSubprotocol(readHeader(req, 'sec-websocket-protocol'));
    if (subprotocolToken) {
      return this.resolveToken(subprotocolToken);
    }
    const cookieValue = readHeader(req, 'cookie');
    const sessionToken = readSessionCookie(cookieValue);
    if (sessionToken) {
      return this.resolver.resolveSessionToken(sessionToken);
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

/**
 * Browser WebSocket clients pass the bearer token as the second value in
 * `Sec-WebSocket-Protocol: bearer, <token>`. The header may concatenate
 * multiple `Sec-WebSocket-Protocol` lines into a single comma-separated
 * value; we only honor the first `bearer + token` pair we find.
 */
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

function ownsEvent(event: EventRow, endUserId: string): boolean {
  const owner = event.payload?.['endUserId'];
  if (typeof owner === 'string') return owner === endUserId;
  return event.type.startsWith('conversation.');
}
