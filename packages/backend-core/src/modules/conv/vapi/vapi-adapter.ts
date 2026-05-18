import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { makeId, schema, type Db, type Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.js';
import type {
  ChannelAdapter,
  ChannelRow,
  InboundBatch,
  InboundMode,
  IncomingWebhookRequest,
  SendContext,
  SendResult,
  WebhookResponse,
} from '../channels/adapter.js';
import {
  VAPI_WEBHOOK_SECRET_HEADER,
  VapiClientService,
  verifyVapiWebhookSecret,
} from './vapi-client.service.js';
import { jsonbToStored } from './vapi.service.js';
import { VapiToolBridge, type VapiToolCall } from './vapi-tool-bridge.js';

interface VapiServerMessage {
  type: string;
  call?: {
    id?: string;
    customer?: { number?: string; name?: string; email?: string };
    metadata?: Record<string, unknown>;
    assistantOverrides?: { metadata?: Record<string, unknown> };
  };
  artifact?: { recordingUrl?: string; transcript?: string };
  endedReason?: string;
  durationSeconds?: number;
  role?: 'user' | 'assistant' | 'system';
  transcript?: string;
  transcriptType?: 'partial' | 'final';
  conversation?: VapiConversationEntry[];
  toolCalls?: VapiToolCall[];
  toolCallList?: VapiToolCall[];
  toolWithToolCallList?: Array<{ toolCall?: VapiToolCall }>;
}

interface VapiConversationEntry {
  role?: string;
  content?: string;
  message?: string;
  toolCalls?: VapiToolCall[];
}

@Injectable()
export class VapiAdapter implements ChannelAdapter {
  readonly kind = 'voice' as const;
  readonly vendors = ['vapi'] as const;

  private readonly logger = new Logger(VapiAdapter.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VapiClientService) private readonly client: VapiClientService,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(VapiToolBridge) private readonly tools: VapiToolBridge,
  ) {}

  readonly inbound: InboundMode = {
    mode: 'webhook',
    verify: (req, channel) => this.verify(req, channel),
  };

  send(_ctx: SendContext): Promise<SendResult> {
    return Promise.resolve({ providerMessageId: null });
  }

  private async verify(req: IncomingWebhookRequest, channel: ChannelRow): Promise<InboundBatch> {
    const config = jsonbToStored(channel.config);
    const expected = await this.client.loadSecret(config.encryptedWebhookSecret);
    const provided = headerOne(req.headers, VAPI_WEBHOOK_SECRET_HEADER) ?? '';
    if (!provided) throw new Error('vapi_webhook_secret_missing');
    if (!verifyVapiWebhookSecret({ expected, provided })) {
      throw new Error('vapi_webhook_secret_invalid');
    }

    let envelope: { message?: VapiServerMessage } | VapiServerMessage;
    try {
      envelope = JSON.parse(req.rawBody.toString('utf8')) as
        | { message?: VapiServerMessage }
        | VapiServerMessage;
    } catch {
      throw new Error('vapi_body_not_json');
    }
    const msg: VapiServerMessage =
      'message' in envelope && envelope.message ? envelope.message : (envelope as VapiServerMessage);

    switch (msg.type) {
      case 'transcript':
        await this.handleTranscript(channel, msg);
        return { messages: [] };
      case 'conversation-update':
        await this.handleConversationUpdate(channel, msg);
        return { messages: [] };
      case 'tool-calls': {
        const body = await this.handleToolCalls(channel, msg);
        return {
          messages: [],
          responseOverride: body,
        };
      }
      case 'end-of-call-report':
        await this.handleEndOfCallReport(channel, msg);
        return { messages: [] };
      case 'status-update':
        this.logger.debug(`vapi status callId=${msg.call?.id ?? '?'}`);
        return { messages: [] };
      default:
        this.logger.debug(`vapi event ignored: ${msg.type}`);
        return { messages: [] };
    }
  }

  private async handleTranscript(channel: ChannelRow, msg: VapiServerMessage): Promise<void> {
    if (msg.transcriptType !== 'final') return;
    const callId = msg.call?.id;
    const text = msg.transcript?.trim();
    if (!callId || !text || !msg.role) return;

    await this.runAsSystem(channel, async (tx) => {
      const conversation = await this.resolveConversation(tx, channel, msg);
      const turnIndex = await this.nextTurnIndex(tx, conversation.id);
      const role: 'user' | 'assistant' = msg.role === 'user' ? 'user' : 'assistant';
      await this.insertVoiceMessage(tx, channel, conversation, {
        role,
        text,
        callId,
        voiceTurnIndex: turnIndex,
      });
    });
  }

  private async handleConversationUpdate(channel: ChannelRow, msg: VapiServerMessage): Promise<void> {
    const callId = msg.call?.id;
    const entries = msg.conversation;
    if (!callId || !entries || entries.length === 0) return;

    await this.runAsSystem(channel, async (tx) => {
      const conversation = await this.resolveConversation(tx, channel, msg);
      const seen = await this.loadSeenVoiceTurns(tx, conversation.id, callId);
      let nextIndex = seen.maxIndex + 1;

      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]!;
        const role = mapRoleForVoice(entry.role);
        if (!role) continue;
        const text = pickEntryText(entry);
        if (!text) continue;
        const existing = seen.byIndex.get(i);
        if (existing) {
          if (text.length > existing.body.length && text !== existing.body) {
            await tx
              .update(schema.convMessages)
              .set({ body: text })
              .where(eq(schema.convMessages.id, existing.id));
          }
          continue;
        }
        await this.insertVoiceMessage(tx, channel, conversation, {
          role,
          text,
          callId,
          voiceTurnIndex: i,
          fallbackIndex: nextIndex,
        });
        nextIndex += 1;
      }
    });
  }

  private async handleToolCalls(
    channel: ChannelRow,
    msg: VapiServerMessage,
  ): Promise<WebhookResponse> {
    const toolCalls = collectToolCalls(msg);
    if (toolCalls.length === 0) {
      return { status: 200, contentType: 'application/json; charset=utf-8', body: '{"results":[]}' };
    }

    const meta = readCallMetadata(msg);
    const conversationId = typeof meta.conversationId === 'string' ? meta.conversationId : null;

    let endUserId: string | null = null;
    if (conversationId) {
      const rows = await this.db
        .select({ endUserId: schema.convConversations.endUserId })
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.orgId, channel.orgId),
            eq(schema.convConversations.id, conversationId),
          ),
        )
        .limit(1);
      endUserId = rows[0]?.endUserId ?? null;
    }
    if (!endUserId) {
      const message = 'voice channel has no associated end-user — tools unavailable';
      return jsonResponse({
        results: toolCalls.map((c) => ({
          toolCallId: c.id ?? randomUUID(),
          error: message,
        })),
      });
    }

    const results = await this.tools.dispatch({
      orgId: channel.orgId,
      endUserId,
      toolCalls,
    });
    return jsonResponse({ results });
  }

  private async insertVoiceMessage(
    tx: Db | Tx,
    channel: ChannelRow,
    conversation: typeof schema.convConversations.$inferSelect,
    args: {
      role: 'user' | 'assistant';
      text: string;
      callId: string;
      voiceTurnIndex: number;
      fallbackIndex?: number;
    },
  ): Promise<void> {
    const authorType = args.role === 'user' ? 'end_user' : 'agent';
    const authorId =
      args.role === 'user' ? conversation.contactId ?? 'voice-user' : 'vapi';
    const [stored] = await tx
      .insert(schema.convMessages)
      .values({
        orgId: channel.orgId,
        conversationId: conversation.id,
        authorType,
        authorId: authorId || 'vapi',
        body: args.text,
        internal: false,
        metadata: {
          vapiCallId: args.callId,
          vapiRole: args.role,
          voiceTurnIndex: args.voiceTurnIndex,
          ...(args.fallbackIndex !== undefined ? { voiceFallbackIndex: args.fallbackIndex } : {}),
        },
      })
      .returning();
    await tx
      .update(schema.convConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.convConversations.id, conversation.id));
    if (stored) {
      await this.webhooks.emit({
        type: 'conversation.message.received',
        payload: {
          conversationId: conversation.id,
          messageId: stored.id,
          authorType,
          internal: false,
        },
      });
    }
  }

  private async runAsSystem(
    channel: ChannelRow,
    fn: (tx: Db | Tx) => Promise<void>,
  ): Promise<void> {
    const actor = new ActorIdentity('system', 'vapi-webhook', channel.orgId, ['*'], ['admin']);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, () => fn(tx));
    });
  }

  private async resolveConversation(
    tx: Db | Tx,
    channel: ChannelRow,
    msg: VapiServerMessage,
  ): Promise<typeof schema.convConversations.$inferSelect> {
    const meta = readCallMetadata(msg);
    if (typeof meta.conversationId === 'string') {
      const rows = await tx
        .select()
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.orgId, channel.orgId),
            eq(schema.convConversations.id, meta.conversationId),
          ),
        )
        .limit(1);
      if (rows[0]) {
        if (rows[0].metadata.vapiCallId !== msg.call?.id) {
          await tx
            .update(schema.convConversations)
            .set({
              metadata: {
                ...rows[0].metadata,
                vapiCallId: msg.call?.id ?? null,
              },
            })
            .where(eq(schema.convConversations.id, rows[0].id));
        }
        return rows[0];
      }
    }

    const callId = msg.call?.id;
    if (!callId) throw new Error('vapi_event_missing_call_id_or_conversation_id');
    return this.findOrCreateConversation(tx, channel, callId, msg.call?.customer);
  }

  private async loadSeenVoiceTurns(
    tx: Db | Tx,
    conversationId: string,
    callId: string,
  ): Promise<{
    byIndex: Map<number, { id: string; body: string }>;
    maxIndex: number;
  }> {
    const rows = await tx
      .select({
        id: schema.convMessages.id,
        body: schema.convMessages.body,
        metadata: schema.convMessages.metadata,
      })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          sql`${schema.convMessages.metadata}->>'vapiCallId' = ${callId}`,
        ),
      );
    const byIndex = new Map<number, { id: string; body: string }>();
    let maxIndex = -1;
    for (const row of rows) {
      const idx =
        typeof row.metadata.voiceTurnIndex === 'number' ? row.metadata.voiceTurnIndex : null;
      if (idx !== null) {
        byIndex.set(idx, { id: row.id, body: row.body });
        if (idx > maxIndex) maxIndex = idx;
      }
    }
    return { byIndex, maxIndex };
  }

  private async handleEndOfCallReport(channel: ChannelRow, msg: VapiServerMessage): Promise<void> {
    const callId = msg.call?.id;
    if (!callId) return;
    await this.runAsSystem(channel, async (tx) => {
      const conversation = await this.resolveConversation(tx, channel, msg);
      const callMeta = {
        vapiCallId: callId,
        recordingUrl: msg.artifact?.recordingUrl ?? null,
        endedReason: msg.endedReason ?? null,
        durationSeconds: msg.durationSeconds ?? null,
        fullTranscript: msg.artifact?.transcript ?? null,
      };
      const nextMeta: Record<string, unknown> = {
        ...conversation.metadata,
        vapiCall: callMeta,
        voiceActive: false,
      };
      delete nextMeta.voiceStartedAt;
      await tx
        .update(schema.convConversations)
        .set({
          metadata: nextMeta,
          updatedAt: new Date(),
        })
        .where(eq(schema.convConversations.id, conversation.id));
      await this.webhooks.emit({
        type: 'conversation.voice.call_ended',
        payload: {
          orgId: channel.orgId,
          conversationId: conversation.id,
          channelId: channel.id,
          recordingUrl: callMeta.recordingUrl,
          endedReason: callMeta.endedReason,
          durationSeconds: callMeta.durationSeconds,
        },
      });
    });
  }

  private async findOrCreateConversation(
    tx: Db | Tx,
    channel: ChannelRow,
    callId: string,
    customer: { number?: string; name?: string; email?: string } | undefined,
  ): Promise<typeof schema.convConversations.$inferSelect> {
    const existing = await tx
      .select()
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, channel.orgId),
          eq(schema.convConversations.channelId, channel.id),
          sql`${schema.convConversations.metadata}->>'vapiCallId' = ${callId}`,
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const phone = customer?.number;
    const contact = await findOrCreateContactByPhone(tx, channel.orgId, phone, customer?.name);

    const next = await tx.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${channel.orgId}) AS next`,
    );
    const displayId = next[0]!.next;
    const metadata = { vapiCallId: callId };
    const newId = makeId('ccv');
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO conv_conversations
        (id, org_id, display_id, channel_id, contact_id, end_user_id, status, subject, last_message_at, metadata)
      VALUES
        (${newId}, ${channel.orgId}, ${displayId}, ${channel.id}, ${contact?.id ?? null},
         ${contact?.endUserId ?? null}, 'open', NULL, ${new Date().toISOString()},
         ${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT (org_id, channel_id, ((metadata ->> 'vapiCallId')))
        WHERE (metadata ->> 'vapiCallId') IS NOT NULL
      DO NOTHING
      RETURNING id
    `);
    const insertedId = inserted[0]?.id;
    if (insertedId) {
      const created = await tx
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, insertedId))
        .limit(1);
      return created[0]!;
    }
    const concurrent = await tx
      .select()
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, channel.orgId),
          eq(schema.convConversations.channelId, channel.id),
          sql`${schema.convConversations.metadata}->>'vapiCallId' = ${callId}`,
        ),
      )
      .limit(1);
    if (!concurrent[0]) throw new Error('vapi_conversation_race_lost_but_missing');
    return concurrent[0];
  }

  private async nextTurnIndex(tx: Db | Tx, conversationId: string): Promise<number> {
    const rows = await tx.execute<{ n: string | number } & Record<string, unknown>>(
      sql`SELECT COUNT(*) AS n FROM conv_messages WHERE conversation_id = ${conversationId}`,
    );
    const n = rows[0]?.n;
    return typeof n === 'number' ? n : parseInt(String(n ?? 0), 10);
  }
}

async function findOrCreateContactByPhone(
  tx: Db | Tx,
  orgId: string,
  phone: string | undefined,
  name: string | undefined,
): Promise<typeof schema.convContacts.$inferSelect | null> {
  if (!phone) return null;
  const existing = await tx
    .select()
    .from(schema.convContacts)
    .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.phone, phone)))
    .limit(1);
  if (existing[0]) return existing[0];

  const externalId = `phone:${phone}`;
  const eu = await tx
    .select()
    .from(schema.endUsers)
    .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
    .limit(1);
  let endUserId: string | null = eu[0]?.id ?? null;
  if (!endUserId) {
    try {
      const [createdEu] = await tx
        .insert(schema.endUsers)
        .values({
          orgId,
          externalId,
          phone,
          name: name ?? null,
          metadata: { source: 'vapi-webhook' },
        })
        .returning();
      endUserId = createdEu?.id ?? null;
    } catch {
      const reread = await tx
        .select()
        .from(schema.endUsers)
        .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
        .limit(1);
      endUserId = reread[0]?.id ?? null;
    }
  }
  const [contact] = await tx
    .insert(schema.convContacts)
    .values({
      orgId,
      phone,
      name: name ?? null,
      endUserId,
      metadata: {},
    })
    .returning();
  return contact ?? null;
}

function headerOne(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = headers[key.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function readCallMetadata(msg: VapiServerMessage): Record<string, unknown> {
  const fromOverrides = msg.call?.assistantOverrides?.metadata;
  if (fromOverrides && typeof fromOverrides === 'object') return fromOverrides;
  return msg.call?.metadata ?? {};
}

function mapRoleForVoice(role: string | undefined): 'user' | 'assistant' | null {
  if (role === 'user') return 'user';
  if (role === 'bot' || role === 'assistant') return 'assistant';
  return null;
}

function pickEntryText(entry: VapiConversationEntry): string {
  const candidate = entry.message ?? entry.content ?? '';
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function collectToolCalls(msg: VapiServerMessage): VapiToolCall[] {
  if (msg.toolCallList && msg.toolCallList.length > 0) return msg.toolCallList;
  if (msg.toolCalls && msg.toolCalls.length > 0) return msg.toolCalls;
  if (msg.toolWithToolCallList && msg.toolWithToolCallList.length > 0) {
    return msg.toolWithToolCallList
      .map((t) => t.toolCall)
      .filter((c): c is VapiToolCall => Boolean(c));
  }
  return [];
}

function jsonResponse(body: unknown): WebhookResponse {
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  };
}
