import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  COMPANY_PROFILE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
  DEFAULT_VOICE_OPENER_COLD,
  DEFAULT_VOICE_OPENER_CONTINUATION,
  DEFAULT_VOICE_SYSTEM_PROMPT,
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_CONTINUATION_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  WebhookDispatcher,
  createPromptCache,
  type KbDocLocation,
  type KbDocReader,
  type PromptCache,
} from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { DbListenerService, type EventRow } from '../../../realtime/db-listener.service.ts';
import { jsonbToStored } from '../vapi/vapi.service.ts';
import { VapiClientService } from '../vapi/vapi-client.service.ts';
import { VapiToolBridge } from '../vapi/vapi-tool-bridge.ts';
import {
  OrgScopedKbDocReader,
  buildInlineAssistantConfig,
  composeVoiceSystemPrompt,
  type ChatMessageSeed,
} from '../vapi/vapi-assistant.ts';
import { WidgetChannelConfig } from './widget.types.ts';
import type {
  WidgetVoiceEventInputT,
  WidgetVoiceEventResult,
  WidgetVoiceStartInputT,
  WidgetVoiceStartResult,
} from './widget.types.ts';
import { enforceOriginAllowlist, verifyIdentity } from './widget-ingest.service.ts';

const HISTORY_TURN_LIMIT = 20;
const PROMPT_CACHE_TTL_MS = 60_000;

interface CachedPromptBundle {
  cache: PromptCache;
  expiresAt: number;
}

const INVALIDATING_KB_SLUGS = new Set<string>([
  COMPANY_PROFILE_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_CONTINUATION_SLUG,
]);

@Injectable()
export class WidgetVoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WidgetVoiceService.name);
  private readonly promptCacheByOrg = new Map<string, CachedPromptBundle>();
  private unsubscribeKbEvents: (() => void) | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VapiClientService) private readonly vapi: VapiClientService,
    @Inject(VapiToolBridge) private readonly toolBridge: VapiToolBridge,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(DbListenerService) private readonly dbListener: DbListenerService,
  ) {}

  onModuleInit(): void {
    this.unsubscribeKbEvents = this.dbListener.subscribe((row) => this.handleKbEvent(row));
  }

  onModuleDestroy(): void {
    this.unsubscribeKbEvents?.();
    this.unsubscribeKbEvents = null;
  }

  private handleKbEvent(row: EventRow): void {
    if (!row.type.startsWith('kb.document.')) return;
    const slug = typeof row.payload['slug'] === 'string' ? row.payload['slug'] : null;
    if (!slug || !INVALIDATING_KB_SLUGS.has(slug)) return;
    const cached = this.promptCacheByOrg.get(row.org_id);
    if (!cached) return;
    void cached.cache.refresh(slug).catch((err) => {
      this.logger.warn(
        `voice prompt-cache refresh failed for org=${row.org_id} slug=${slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  async startSession(
    orgId: string,
    boundChannelId: string,
    input: WidgetVoiceStartInputT,
    requestContext: { origin?: string } = {},
  ): Promise<WidgetVoiceStartResult> {
    if (input.channelId !== boundChannelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);

      const widgetChannelRows = await tx
        .select({ config: schema.convChannels.config })
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, input.channelId))
        .limit(1);
      const widgetConfigParsed = widgetChannelRows[0]
        ? WidgetChannelConfig.safeParse(widgetChannelRows[0].config)
        : null;
      const widgetConfig = widgetConfigParsed?.success ? widgetConfigParsed.data : null;
      if (widgetConfig) {
        enforceOriginAllowlist(widgetConfig, requestContext.origin);
      }
      const identity = widgetConfig
        ? verifyIdentity(widgetConfig, {
            verifiedExternalId: input.verifiedExternalId,
            userHash: input.userHash,
          })
        : { mode: 'anonymous' as const };

      const convRows = await tx
        .select({
          id: schema.convConversations.id,
          channelId: schema.convConversations.channelId,
          endUserId: schema.convConversations.endUserId,
          contactId: schema.convConversations.contactId,
          orgId: schema.convConversations.orgId,
          metadata: schema.convConversations.metadata,
        })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, input.conversationId))
        .limit(1);
      const conv = convRows[0];
      if (!conv || conv.orgId !== orgId) {
        throw new NotFoundException(`conversation ${input.conversationId} not found`);
      }
      if (conv.channelId !== input.channelId) {
        throw new ForbiddenException('conversation_channel_mismatch');
      }
      const convSessionId = (conv.metadata as { sessionId?: unknown } | null)?.sessionId;
      if (convSessionId !== input.sessionId) {
        throw new ForbiddenException('conversation_session_mismatch');
      }
      if (identity.mode === 'verified' && conv.contactId) {
        const [contactRow] = await tx
          .select({ metadata: schema.convContacts.metadata })
          .from(schema.convContacts)
          .where(eq(schema.convContacts.id, conv.contactId))
          .limit(1);
        const contactExt = (contactRow?.metadata as { externalId?: unknown } | null)?.externalId;
        if (contactExt !== identity.externalId) {
          throw new ForbiddenException('conversation_identity_mismatch');
        }
      }
      if (!conv.endUserId) {
        return { available: false, reason: 'conversation_has_no_end_user' };
      }

      const voiceChannelId = widgetConfig?.voiceChannelId;

      const voiceBaseConditions = [
        eq(schema.convChannels.orgId, orgId),
        eq(schema.convChannels.type, 'voice'),
        eq(schema.convChannels.vendor, 'vapi'),
        eq(schema.convChannels.active, true),
        isNull(schema.convChannels.archivedAt),
      ];
      let channel: typeof schema.convChannels.$inferSelect | undefined;
      if (voiceChannelId) {
        const explicit = await tx
          .select()
          .from(schema.convChannels)
          .where(and(...voiceBaseConditions, eq(schema.convChannels.id, voiceChannelId)))
          .limit(1);
        channel = explicit[0];
        if (!channel) {
          return { available: false, reason: 'widget_voice_channel_id_not_found_or_inactive' };
        }
      } else {
        const candidates = await tx
          .select()
          .from(schema.convChannels)
          .where(and(...voiceBaseConditions))
          .limit(2);
        if (candidates.length === 0) {
          return { available: false, reason: 'no_active_voice_channel' };
        }
        if (candidates.length > 1) {
          return {
            available: false,
            reason: 'multiple_voice_channels_without_widget_routing',
          };
        }
        channel = candidates[0]!;
      }
      const storedConfig = jsonbToStored(channel.config);
      if (!storedConfig.publicKey) {
        return { available: false, reason: 'voice_channel_missing_public_key' };
      }

      const apiKey = await this.vapi.loadSecret(storedConfig.encryptedApiKey);
      const fetched = await this.vapi.fetchAssistantConfig({
        apiKey,
        assistantId: storedConfig.assistantId,
      });
      if (!fetched.ok) {
        this.logger.warn(`vapi fetchAssistant failed: ${fetched.error}`);
        return { available: false, reason: `vapi_fetch_assistant_failed:${fetched.error}` };
      }

      const historyRows = await tx
        .select({
          authorType: schema.convMessages.authorType,
          body: schema.convMessages.body,
          internal: schema.convMessages.internal,
        })
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, conv.id))
        .orderBy(asc(schema.convMessages.createdAt))
        .limit(HISTORY_TURN_LIMIT * 2);

      const turns: ChatMessageSeed[] = [];
      for (const row of historyRows) {
        if (row.internal) continue;
        const role = mapAuthorToRole(row.authorType);
        if (!role) continue;
        const text = row.body?.trim();
        if (!text) continue;
        turns.push({ role, content: text });
      }
      const trimmedHistory = turns.slice(-HISTORY_TURN_LIMIT);

      const prompts = await this.getPromptCache(tx, orgId);
      const hadAgentTurn = trimmedHistory.some((m) => m.role === 'assistant');
      const systemPrompt = composeVoiceSystemPrompt(prompts, conv.id);
      const openerInstruction = prompts.get(
        hadAgentTurn ? VOICE_OPENER_CONTINUATION_SLUG : VOICE_OPENER_COLD_SLUG,
      );
      const seededMessages: ChatMessageSeed[] = [
        { role: 'system', content: systemPrompt },
        ...trimmedHistory,
        { role: 'system', content: openerInstruction },
      ];

      const inlineAssistant = buildInlineAssistantConfig({
        baseConfig: fetched.config,
        messages: seededMessages,
        tools: this.toolBridge.buildToolList(),
      });
      this.logger.log(
        `voice/start convId=${conv.id} seededMessages=${seededMessages.length} inlineKeys=${Object.keys(inlineAssistant).join(',')} modelKeys=${
          inlineAssistant.model && typeof inlineAssistant.model === 'object'
            ? Object.keys(inlineAssistant.model).join(',')
            : 'none'
        }`,
      );

      return {
        available: true,
        descriptor: {
          vendor: 'vapi',
          publicKey: storedConfig.publicKey,
          assistantId: storedConfig.assistantId,
          metadata: {
            conversationId: conv.id,
            endUserId: conv.endUserId,
          },
          assistant: inlineAssistant,
        },
      };
    });
  }

  async recordEvent(
    orgId: string,
    boundChannelId: string,
    input: WidgetVoiceEventInputT,
    requestContext: { origin?: string } = {},
  ): Promise<WidgetVoiceEventResult> {
    if (input.channelId !== boundChannelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    const messageId = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);

      const widgetChannelRows = await tx
        .select({ config: schema.convChannels.config })
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, input.channelId))
        .limit(1);
      const widgetConfigParsed = widgetChannelRows[0]
        ? WidgetChannelConfig.safeParse(widgetChannelRows[0].config)
        : null;
      const widgetConfig = widgetConfigParsed?.success ? widgetConfigParsed.data : null;
      if (widgetConfig) {
        enforceOriginAllowlist(widgetConfig, requestContext.origin);
      }
      const identity = widgetConfig
        ? verifyIdentity(widgetConfig, {
            verifiedExternalId: input.verifiedExternalId,
            userHash: input.userHash,
          })
        : { mode: 'anonymous' as const };

      const [conv] = await tx
        .select({
          id: schema.convConversations.id,
          channelId: schema.convConversations.channelId,
          contactId: schema.convConversations.contactId,
          orgId: schema.convConversations.orgId,
          assigneeUserId: schema.convConversations.assigneeUserId,
          metadata: schema.convConversations.metadata,
        })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, input.conversationId))
        .limit(1);
      if (!conv || conv.orgId !== orgId) {
        throw new NotFoundException(`conversation ${input.conversationId} not found`);
      }
      if (conv.channelId !== input.channelId) {
        throw new ForbiddenException('conversation_channel_mismatch');
      }
      const convSessionId = (conv.metadata as { sessionId?: unknown } | null)?.sessionId;
      if (convSessionId !== input.sessionId) {
        throw new ForbiddenException('conversation_session_mismatch');
      }
      if (identity.mode === 'verified' && conv.contactId) {
        const [contactRow] = await tx
          .select({ metadata: schema.convContacts.metadata })
          .from(schema.convContacts)
          .where(eq(schema.convContacts.id, conv.contactId))
          .limit(1);
        const contactExt = (contactRow?.metadata as { externalId?: unknown } | null)?.externalId;
        if (contactExt !== identity.externalId) {
          throw new ForbiddenException('conversation_identity_mismatch');
        }
      }

      let body: string;
      if (input.kind === 'started') {
        const who = await this.resolveCallWho(tx, orgId, conv.assigneeUserId);
        body = `Voice call started · ${who}`;
      } else {
        body = `Call ended · ${formatDuration(input.durationSeconds ?? 0)}`;
      }

      const inserts = await tx
        .insert(schema.convMessages)
        .values({
          orgId,
          conversationId: conv.id,
          authorType: 'system',
          authorId: 'widget-voice',
          body,
          internal: false,
          metadata: {
            kind: input.kind === 'started' ? 'voice_call_started' : 'voice_call_ended',
            durationSeconds: input.durationSeconds,
          },
        })
        .returning({ id: schema.convMessages.id });

      const updatedMetadata = { ...conv.metadata };
      if (input.kind === 'started') {
        updatedMetadata.voiceActive = true;
        updatedMetadata.voiceStartedAt = new Date().toISOString();
      } else {
        updatedMetadata.voiceActive = false;
        updatedMetadata.voiceEndedAt = new Date().toISOString();
        if (typeof input.durationSeconds === 'number') {
          updatedMetadata.voiceLastDurationSeconds = input.durationSeconds;
        }
      }
      await tx
        .update(schema.convConversations)
        .set({ metadata: updatedMetadata, lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.convConversations.id, conv.id));

      return inserts[0]!.id;
    });

    await this.webhooks.emit({
      type: 'conversation.message.sent',
      payload: {
        conversationId: input.conversationId,
        messageId,
        authorType: 'system',
        internal: false,
      },
    });

    return { ok: true };
  }

  private async getPromptCache(tx: Tx, orgId: string): Promise<PromptCache> {
    const cached = this.promptCacheByOrg.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.cache;

    const [org] = await tx
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId))
      .limit(1);
    const orgName = org?.name?.trim() ?? '';
    const companyFallback = orgName ? `Company name: ${orgName}` : '';

    const reader = new OrgScopedKbDocReader(this.db, orgId);
    const cache = await createPromptCache({
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
        [VOICE_OPENER_CONTINUATION_SLUG]: {
          location: {
            spaceSlug: AGENT_RUNTIME_PROMPT_SPACE_SLUG,
            slug: VOICE_OPENER_CONTINUATION_SLUG,
          },
          fallback: DEFAULT_VOICE_OPENER_CONTINUATION,
        },
        [COMPANY_PROFILE_SLUG]: {
          location: { spaceSlug: COMPANY_PROFILE_SPACE_SLUG, slug: COMPANY_PROFILE_SLUG },
          fallback: companyFallback,
        },
      },
      logger: {
        info: (m) => this.logger.debug(m),
        warn: (m) => this.logger.warn(m),
      },
    });

    this.promptCacheByOrg.set(orgId, {
      cache,
      expiresAt: Date.now() + PROMPT_CACHE_TTL_MS,
    });
    return cache;
  }

  private async resolveCallWho(
    tx: Tx,
    orgId: string,
    assigneeUserId: string | null,
  ): Promise<string> {
    if (assigneeUserId) {
      const [user] = await tx
        .select({ name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, assigneeUserId))
        .limit(1);
      if (user) {
        const display = user.name?.trim() || user.email.split('@')[0] || 'Agent';
        return firstWord(display);
      }
    }
    const [assistant] = await tx
      .select({ name: schema.assistants.name })
      .from(schema.assistants)
      .where(eq(schema.assistants.orgId, orgId))
      .limit(1);
    return assistant?.name?.trim() || 'Munin';
  }
}

function firstWord(s: string): string {
  return s.split(/\s+/)[0] ?? s;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function mapAuthorToRole(authorType: string): 'user' | 'assistant' | null {
  if (authorType === 'end_user') return 'user';
  if (authorType === 'agent') return 'assistant';
  return null;
}

