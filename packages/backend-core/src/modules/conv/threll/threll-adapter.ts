import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  COMPANY_PROFILE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
  DEFAULT_VOICE_OPENER_COLD,
  DEFAULT_VOICE_SYSTEM_PROMPT,
  VOICE_OPENER_COLD_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  WebhookDispatcher,
  createPromptCache,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { makeId, schema, type Db, type Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import type {
  ChannelAdapter,
  ChannelRow,
  InboundBatch,
  InboundMode,
  IncomingWebhookRequest,
  SendContext,
  SendResult,
  WebhookResponse,
} from '../channels/adapter.ts';
import {
  OrgScopedKbDocReader,
  composeVoiceSystemPrompt,
} from '../vapi/vapi-assistant.ts';
import {
  THRELL_SIGNATURE_HEADER,
  ThrellClientService,
  buildWebhookUrl,
  verifyThrellSignature,
} from './threll-client.service.ts';
import { jsonbToStored } from './threll.service.ts';
import { ThrellToolBridge } from './threll-tool-bridge.ts';

interface ThrellCustomer {
  number?: string;
  name?: string | null;
  personId?: string | null;
  language?: string | null;
}

interface ThrellEvent {
  type: string;
  data?: {
    callId?: string;
    direction?: 'inbound' | 'outbound';
    customer?: ThrellCustomer;
    toolCallId?: string;
    name?: string;
    arguments?: unknown;
    turnIndex?: number;
    role?: 'user' | 'agent';
    text?: string;
    isFinal?: boolean;
    status?: string;
    recordingAvailable?: boolean;
    analysis?: string | null;
    metadata?: Record<string, unknown> | null;
  };
}

@Injectable()
export class ThrellAdapter implements ChannelAdapter {
  readonly kind = 'voice' as const;
  readonly vendors = ['threll'] as const;

  private readonly logger = new Logger(ThrellAdapter.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ThrellClientService) private readonly client: ThrellClientService,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ThrellToolBridge) private readonly tools: ThrellToolBridge,
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
    const secret = await this.client.loadSecret(config.encryptedWebhookSecret);
    const provided = headerOne(req.headers, THRELL_SIGNATURE_HEADER) ?? '';
    if (!provided) throw new Error('threll_signature_missing');
    if (!verifyThrellSignature({ secret, rawBody: req.rawBody, signature: provided })) {
      throw new Error('threll_signature_invalid');
    }

    let event: ThrellEvent;
    try {
      event = JSON.parse(req.rawBody.toString('utf8')) as ThrellEvent;
    } catch {
      throw new Error('threll_body_not_json');
    }

    switch (event.type) {
      case 'call.worker_request':
        return { messages: [], responseOverride: await this.handleWorkerRequest(channel, event) };
      case 'call.tool_call':
        return { messages: [], responseOverride: await this.handleToolCall(channel, event) };
      case 'call.transcript':
        await this.handleTranscript(channel, event);
        return { messages: [] };
      case 'call.status_update':
        this.logger.debug(`threll status callId=${event.data?.callId ?? '?'} ${event.data?.status ?? ''}`);
        return { messages: [] };
      case 'call.ended':
        await this.handleEnded(channel, event);
        return { messages: [] };
      default:
        this.logger.debug(`threll event ignored: ${event.type}`);
        return { messages: [] };
    }
  }

  private async handleWorkerRequest(channel: ChannelRow, event: ThrellEvent): Promise<WebhookResponse> {
    const emptyBody = {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: '{}',
    } satisfies WebhookResponse;
    try {
      const callId = event.data?.callId;
      if (!callId) throw new Error('worker_request_missing_call_id');

      const { conversationId, endUserId, crmContact } = await this.runAsSystem(
        channel,
        async (tx) => {
          const conversation = await this.findOrCreateConversation(
            tx,
            channel,
            callId,
            event.data?.customer,
          );
          const phone = event.data?.customer?.number;
          let crm: { name: string | null; email: string | null } | null = null;
          if (phone) {
            const rows = await tx
              .select({ name: schema.crmContacts.name, email: schema.crmContacts.email })
              .from(schema.crmContacts)
              .where(
                and(
                  eq(schema.crmContacts.orgId, channel.orgId),
                  eq(schema.crmContacts.phone, phone),
                ),
              )
              .limit(1);
            crm = rows[0] ?? null;
          }
          return {
            conversationId: conversation.id,
            endUserId: conversation.endUserId,
            crmContact: crm,
          };
        },
      );

      const reader = new OrgScopedKbDocReader(this.db, channel.orgId);
      const prompts = await createPromptCache({
        reader,
        entries: {
          [VOICE_SYSTEM_PROMPT_SLUG]: {
            location: { spaceSlug: AGENT_RUNTIME_PROMPT_SPACE_SLUG, slug: VOICE_SYSTEM_PROMPT_SLUG },
            fallback: DEFAULT_VOICE_SYSTEM_PROMPT,
          },
          [VOICE_OPENER_COLD_SLUG]: {
            location: { spaceSlug: AGENT_RUNTIME_PROMPT_SPACE_SLUG, slug: VOICE_OPENER_COLD_SLUG },
            fallback: DEFAULT_VOICE_OPENER_COLD,
          },
          [COMPANY_PROFILE_SLUG]: {
            location: { spaceSlug: COMPANY_PROFILE_SPACE_SLUG, slug: COMPANY_PROFILE_SLUG },
          },
        },
      });

      const callerContext = formatCallerContext(event.data?.customer, crmContact);
      const systemPrompt = composeVoiceSystemPrompt(prompts, conversationId, callerContext);
      const opener = prompts.get(VOICE_OPENER_COLD_SLUG);
      const instructions = opener ? `${systemPrompt}\n\n${opener}` : systemPrompt;

      const deliveryUrl = buildWebhookUrl(channel.id);
      const tools = deliveryUrl
        ? this.tools.buildToolList({
            deliveryUrl,
            signingSecret: await this.client.loadSecret(jsonbToStored(channel.config).encryptedWebhookSecret),
          })
        : [];

      const body = JSON.stringify({
        instructions,
        tools,
        metadata: { conversationId, endUserId },
      });

      this.logger.log(
        `threll worker_request callId=${callId} convId=${conversationId} crmHit=${crmContact ? 'yes' : 'no'} tools=${tools.length}`,
      );
      return { status: 200, contentType: 'application/json; charset=utf-8', body };
    } catch (err) {
      this.logger.warn(
        `threll worker_request build failed; proceeding with worker defaults: ${err instanceof Error ? err.message : String(err)}`,
      );
      return emptyBody;
    }
  }

  private async handleToolCall(channel: ChannelRow, event: ThrellEvent): Promise<WebhookResponse> {
    const name = event.data?.name;
    if (!name) return jsonResponse({ result: { error: 'tool_call_missing_name' } });

    const conversationId = readConversationId(event);
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
    if (!endUserId && event.data?.callId) {
      const rows = await this.db
        .select({ endUserId: schema.convConversations.endUserId })
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.orgId, channel.orgId),
            eq(schema.convConversations.channelId, channel.id),
            sql`${schema.convConversations.metadata}->>'threllCallId' = ${event.data.callId}`,
          ),
        )
        .limit(1);
      endUserId = rows[0]?.endUserId ?? null;
    }
    if (!endUserId) {
      return jsonResponse({ result: { error: 'voice channel has no associated end-user — tools unavailable' } });
    }

    const dispatched = await this.tools.dispatch({
      orgId: channel.orgId,
      endUserId,
      name,
      args: event.data?.arguments,
    });
    if (!dispatched.ok) return jsonResponse({ result: { error: dispatched.error } });
    return jsonResponse({ result: dispatched.result });
  }

  private async handleTranscript(channel: ChannelRow, event: ThrellEvent): Promise<void> {
    if (event.data?.isFinal !== true) return;
    const callId = event.data?.callId;
    const text = event.data?.text?.trim();
    const role = mapRole(event.data?.role);
    if (!callId || !text || !role) return;

    await this.runAsSystem(channel, async (tx) => {
      const conversation = await this.resolveConversation(tx, channel, event);
      const turnIndex =
        typeof event.data?.turnIndex === 'number'
          ? event.data.turnIndex
          : await this.nextTurnIndex(tx, conversation.id);
      await this.insertVoiceMessage(tx, channel, conversation, { role, text, callId, voiceTurnIndex: turnIndex });
    });
  }

  private async handleEnded(channel: ChannelRow, event: ThrellEvent): Promise<void> {
    const callId = event.data?.callId;
    if (!callId) return;
    await this.runAsSystem(channel, async (tx) => {
      const conversation = await this.resolveConversation(tx, channel, event);
      const callMeta = {
        threllCallId: callId,
        recordingAvailable: event.data?.recordingAvailable ?? false,
        endedReason: event.data?.status ?? null,
        analysis: event.data?.analysis ?? null,
      };
      const nextMeta: Record<string, unknown> = {
        ...conversation.metadata,
        threllCall: callMeta,
        voiceActive: false,
      };
      delete nextMeta.voiceStartedAt;
      await tx
        .update(schema.convConversations)
        .set({ metadata: nextMeta, status: 'closed', updatedAt: new Date() })
        .where(eq(schema.convConversations.id, conversation.id));
      await this.webhooks.emit({
        type: 'conversation.voice.call_ended',
        payload: {
          orgId: channel.orgId,
          conversationId: conversation.id,
          channelId: channel.id,
          recordingAvailable: callMeta.recordingAvailable,
          endedReason: callMeta.endedReason,
        },
      });
    });
  }

  private async insertVoiceMessage(
    tx: Db | Tx,
    channel: ChannelRow,
    conversation: typeof schema.convConversations.$inferSelect,
    args: { role: 'user' | 'assistant'; text: string; callId: string; voiceTurnIndex: number },
  ): Promise<void> {
    const authorType = args.role === 'user' ? 'end_user' : 'agent';
    const authorId = args.role === 'user' ? conversation.contactId ?? 'voice-user' : 'threll';
    const [stored] = await tx
      .insert(schema.convMessages)
      .values({
        orgId: channel.orgId,
        conversationId: conversation.id,
        authorType,
        authorId: authorId || 'threll',
        body: args.text,
        internal: false,
        metadata: {
          threllCallId: args.callId,
          threllRole: args.role,
          voiceTurnIndex: args.voiceTurnIndex,
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

  private async runAsSystem<T = void>(
    channel: ChannelRow,
    fn: (tx: Db | Tx) => Promise<T>,
  ): Promise<T> {
    const actor = new ActorIdentity('system', 'threll-webhook', channel.orgId, ['*'], ['admin']);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, () => fn(tx));
    });
  }

  private async resolveConversation(
    tx: Db | Tx,
    channel: ChannelRow,
    event: ThrellEvent,
  ): Promise<typeof schema.convConversations.$inferSelect> {
    const conversationId = readConversationId(event);
    if (conversationId) {
      const rows = await tx
        .select()
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.orgId, channel.orgId),
            eq(schema.convConversations.id, conversationId),
          ),
        )
        .limit(1);
      if (rows[0]) return rows[0];
    }
    const callId = event.data?.callId;
    if (!callId) throw new Error('threll_event_missing_call_id_or_conversation_id');
    return this.findOrCreateConversation(tx, channel, callId, event.data?.customer);
  }

  private async findOrCreateConversation(
    tx: Db | Tx,
    channel: ChannelRow,
    callId: string,
    customer: ThrellCustomer | undefined,
  ): Promise<typeof schema.convConversations.$inferSelect> {
    const existing = await tx
      .select()
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, channel.orgId),
          eq(schema.convConversations.channelId, channel.id),
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const contact = await findOrCreateContactByPhone(
      tx,
      channel.orgId,
      customer?.number,
      customer?.name ?? undefined,
    );

    const next = await tx.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${channel.orgId}) AS next`,
    );
    const displayId = next[0]!.next;
    const metadata = { threllCallId: callId };
    const newId = makeId('ccv');
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO conv_conversations
        (id, org_id, display_id, channel_id, contact_id, end_user_id, status, subject, last_message_at, metadata)
      VALUES
        (${newId}, ${channel.orgId}, ${displayId}, ${channel.id}, ${contact?.id ?? null},
         ${contact?.endUserId ?? null}, 'open', NULL, ${new Date().toISOString()},
         ${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT (org_id, channel_id, ((metadata ->> 'threllCallId')))
        WHERE (metadata ->> 'threllCallId') IS NOT NULL
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
          sql`${schema.convConversations.metadata}->>'threllCallId' = ${callId}`,
        ),
      )
      .limit(1);
    if (!concurrent[0]) throw new Error('threll_conversation_race_lost_but_missing');
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
        .values({ orgId, externalId, phone, name: name ?? null, metadata: { source: 'threll-webhook' } })
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
    .values({ orgId, phone, name: name ?? null, endUserId, metadata: {} })
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

function readConversationId(event: ThrellEvent): string | null {
  const meta = event.data?.metadata;
  if (meta && typeof meta === 'object' && typeof meta.conversationId === 'string') {
    return meta.conversationId;
  }
  return null;
}

function mapRole(role: string | undefined): 'user' | 'assistant' | null {
  if (role === 'user') return 'user';
  if (role === 'agent') return 'assistant';
  return null;
}

function jsonResponse(body: unknown): WebhookResponse {
  return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

function formatCallerContext(
  customer: ThrellCustomer | undefined,
  crm: { name: string | null; email: string | null } | null,
): string | undefined {
  const phone = customer?.number;
  const callerName = customer?.name ?? crm?.name ?? null;
  const email = crm?.email ?? null;
  if (!phone && !callerName && !email) return undefined;
  const lines = ['[Caller]'];
  if (callerName) lines.push(`Name: ${callerName}`);
  if (phone) lines.push(`Phone: ${phone}`);
  if (email) lines.push(`Email: ${email}`);
  if (!crm) lines.push('Not in CRM yet — this is a first-time caller.');
  return lines.join('\n');
}
