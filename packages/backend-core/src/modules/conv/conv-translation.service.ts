import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { getCurrentContext, sameAfterNormalizing, WebhookDispatcher } from '@getmunin/core';
import { ConvService, type MessageDto } from './conv.service.ts';
import { MessageTranslatorRegistry } from './message-translator.ts';
import {
  TRANSLATABLE_AUTHORS,
  normalizeLanguageTag,
  sameLanguage,
} from './translation-helpers.ts';

export interface PendingTranslationMessage {
  id: string;
  authorType: 'end_user' | 'agent' | 'user';
  body: string;
}

export interface PendingTranslations {
  conversationId: string;
  customerLanguage: string | null;
  targetLanguage: string;
  messages: PendingTranslationMessage[];
}

export interface ConversationTranslations {
  customerLanguage: string | null;
  targetLanguage: string;
  messages: Record<string, string>;
}

export interface SaveTranslationsInput {
  conversationId: string;
  targetLanguage: string;
  customerLanguage?: string | null;
  translations: Array<{ messageId: string; body: string }>;
}

export interface SendTranslatedReplyInput {
  conversationId: string;
  body: string;
  sourceLanguage: string;
  authorId: string;
  fromDraftId?: string;
  attachmentIds?: string[];
  claim?: boolean;
  inReplyToId?: string;
}

@Injectable()
export class ConvTranslationService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ConvService) private readonly conv: Pick<ConvService, 'sendMessage'>,
    @Inject(MessageTranslatorRegistry) private readonly translators: MessageTranslatorRegistry,
  ) {}

  async sendTranslatedReply(input: SendTranslatedReplyInput): Promise<MessageDto> {
    const source = normalizeLanguageTag(input.sourceLanguage);
    const conv = await this.loadConversation(input.conversationId);
    const send = (body: string, approvalBody?: string) =>
      this.conv.sendMessage({
        conversationId: input.conversationId,
        body,
        ...(approvalBody !== undefined ? { approvalBody } : {}),
        authorType: 'user',
        authorId: input.authorId,
        fromDraftId: input.fromDraftId,
        attachmentIds: input.attachmentIds,
        claim: input.claim,
        inReplyToId: input.inReplyToId,
      });
    if (!conv.customerLanguage) {
      throw new BadRequestException({
        message: `conv_translation_unavailable: the language of conversation ${input.conversationId} is not known yet, so the reply cannot be translated`,
        code: 'conv_translation_unavailable',
      });
    }
    if (sameLanguage(conv.customerLanguage, source)) return send(input.body);

    const untouchedDraft = input.fromDraftId
      ? await this.untouchedDraftOriginal(input.conversationId, input.fromDraftId, source, input.body)
      : null;
    if (untouchedDraft !== null) {
      const message = await send(untouchedDraft);
      await this.keepTeammateVersion(conv.orgId, input.conversationId, message.id, source, input.body);
      return message;
    }

    const translator = this.translators.get();
    if (!translator) {
      throw new ServiceUnavailableException({
        message: 'conv_translation_unavailable: no agent is running to translate the reply',
        code: 'conv_translation_unavailable',
      });
    }
    let translated: string;
    try {
      translated = (
        await translator.translateText({
          orgId: conv.orgId,
          text: input.body,
          sourceLanguage: source,
          targetLanguage: conv.customerLanguage,
        })
      ).trim();
    } catch (err) {
      throw new BadGatewayException({
        message: `conv_translation_failed: ${err instanceof Error ? err.message : String(err)}`,
        code: 'conv_translation_failed',
      });
    }
    if (!translated) {
      throw new BadGatewayException({
        message: 'conv_translation_failed: the translation came back empty',
        code: 'conv_translation_failed',
      });
    }

    const message = await send(translated, input.body);
    await this.keepTeammateVersion(conv.orgId, input.conversationId, message.id, source, input.body);
    return message;
  }

  private async untouchedDraftOriginal(
    conversationId: string,
    draftId: string,
    language: string,
    body: string,
  ): Promise<string | null> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({
        body: schema.convMessages.body,
        translated: schema.convMessageTranslations.body,
      })
      .from(schema.convMessages)
      .innerJoin(
        schema.convMessageTranslations,
        and(
          eq(schema.convMessageTranslations.messageId, schema.convMessages.id),
          eq(schema.convMessageTranslations.targetLanguage, language),
        ),
      )
      .where(
        and(
          eq(schema.convMessages.id, draftId),
          eq(schema.convMessages.conversationId, conversationId),
          sql`${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'`,
        ),
      )
      .limit(1);
    return row && sameAfterNormalizing(row.translated, body) ? row.body : null;
  }

  private async keepTeammateVersion(
    orgId: string,
    conversationId: string,
    messageId: string,
    language: string,
    body: string,
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .insert(schema.convMessageTranslations)
      .values({ orgId, conversationId, messageId, targetLanguage: language, body })
      .onConflictDoUpdate({
        target: [
          schema.convMessageTranslations.messageId,
          schema.convMessageTranslations.targetLanguage,
        ],
        set: { body: sql`excluded.body` },
      });
  }

  async requestTranslation(
    conversationId: string,
    targetLanguage: string,
  ): Promise<{ requested: boolean }> {
    const target = normalizeLanguageTag(targetLanguage);
    const pending = await this.pendingTranslations(conversationId, target);
    if (pending.messages.length === 0) return { requested: false };
    const conv = await this.loadConversation(conversationId);
    await this.webhooks.emit({
      type: 'conversation.translation_requested',
      payload: { conversationId, endUserId: conv.endUserId, targetLanguage: target },
    });
    return { requested: true };
  }

  async pendingTranslations(
    conversationId: string,
    targetLanguage: string,
  ): Promise<PendingTranslations> {
    const target = normalizeLanguageTag(targetLanguage);
    const conv = await this.loadConversation(conversationId);
    const base: PendingTranslations = {
      conversationId,
      customerLanguage: conv.customerLanguage,
      targetLanguage: target,
      messages: [],
    };
    if (conv.customerLanguage && sameLanguage(conv.customerLanguage, target)) return base;
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        id: schema.convMessages.id,
        authorType: schema.convMessages.authorType,
        body: schema.convMessages.body,
      })
      .from(schema.convMessages)
      .leftJoin(
        schema.convMessageTranslations,
        and(
          eq(schema.convMessageTranslations.messageId, schema.convMessages.id),
          eq(schema.convMessageTranslations.targetLanguage, target),
        ),
      )
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          eq(schema.convMessages.internal, false),
          inArray(schema.convMessages.authorType, [...TRANSLATABLE_AUTHORS]),
          sql`btrim(${schema.convMessages.body}) <> ''`,
          isNull(schema.convMessageTranslations.id),
        ),
      )
      .orderBy(asc(schema.convMessages.createdAt));
    const draft = await this.pendingDraftToTranslate(conversationId, target, conv.customerLanguage);
    return {
      ...base,
      messages: [
        ...rows.map((r) => ({
          id: r.id,
          authorType: r.authorType as PendingTranslationMessage['authorType'],
          body: r.body,
        })),
        ...(draft ? [draft] : []),
      ],
    };
  }

  private async pendingDraftToTranslate(
    conversationId: string,
    target: string,
    customerLanguage: string | null,
  ): Promise<PendingTranslationMessage | null> {
    const ctx = getCurrentContext();
    const [draft] = await ctx.db
      .select({
        id: schema.convMessages.id,
        body: schema.convMessages.body,
        language: sql<string | null>`${schema.convMessages.metadata} ->> 'language'`,
      })
      .from(schema.convMessages)
      .leftJoin(
        schema.convMessageTranslations,
        and(
          eq(schema.convMessageTranslations.messageId, schema.convMessages.id),
          eq(schema.convMessageTranslations.targetLanguage, target),
        ),
      )
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          sql`${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'`,
          isNull(schema.convMessageTranslations.id),
        ),
      )
      .orderBy(desc(schema.convMessages.createdAt))
      .limit(1);
    if (!draft) return null;
    const language = draft.language ?? customerLanguage;
    if (language && sameLanguage(language, target)) return null;
    return { id: draft.id, authorType: 'agent', body: draft.body };
  }

  async translationsFor(
    conversationId: string,
    targetLanguage: string,
  ): Promise<ConversationTranslations> {
    const target = normalizeLanguageTag(targetLanguage);
    const conv = await this.loadConversation(conversationId);
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        messageId: schema.convMessageTranslations.messageId,
        body: schema.convMessageTranslations.body,
      })
      .from(schema.convMessageTranslations)
      .where(
        and(
          eq(schema.convMessageTranslations.conversationId, conversationId),
          eq(schema.convMessageTranslations.targetLanguage, target),
        ),
      );
    return {
      customerLanguage: conv.customerLanguage,
      targetLanguage: target,
      messages: Object.fromEntries(rows.map((r) => [r.messageId, r.body])),
    };
  }

  async saveTranslations(input: SaveTranslationsInput): Promise<{ saved: number }> {
    const target = normalizeLanguageTag(input.targetLanguage);
    const customerLanguage =
      input.customerLanguage == null ? null : normalizeLanguageTag(input.customerLanguage);
    const conv = await this.loadConversation(input.conversationId);
    const ctx = getCurrentContext();

    const byId = new Map<string, string>();
    for (const t of input.translations) {
      if (t.body.trim()) byId.set(t.messageId, t.body);
    }
    const eligible =
      byId.size === 0
        ? []
        : await ctx.db
            .select({ id: schema.convMessages.id })
            .from(schema.convMessages)
            .where(
              and(
                eq(schema.convMessages.conversationId, input.conversationId),
                or(
                  and(
                    eq(schema.convMessages.internal, false),
                    inArray(schema.convMessages.authorType, [...TRANSLATABLE_AUTHORS]),
                  ),
                  sql`${schema.convMessages.metadata} ->> 'kind' = 'draft_reply'`,
                ),
                inArray(schema.convMessages.id, [...byId.keys()]),
              ),
            );

    if (customerLanguage && customerLanguage !== conv.customerLanguage) {
      await ctx.db
        .update(schema.convConversations)
        .set({ customerLanguage })
        .where(eq(schema.convConversations.id, input.conversationId));
    }
    if (eligible.length > 0) {
      await ctx.db
        .insert(schema.convMessageTranslations)
        .values(
          eligible.map((m) => ({
            orgId: conv.orgId,
            conversationId: input.conversationId,
            messageId: m.id,
            targetLanguage: target,
            body: byId.get(m.id)!,
          })),
        )
        .onConflictDoUpdate({
          target: [
            schema.convMessageTranslations.messageId,
            schema.convMessageTranslations.targetLanguage,
          ],
          set: { body: sql`excluded.body` },
        });
    }
    await this.webhooks.emit({
      type: 'conversation.translated',
      payload: {
        conversationId: input.conversationId,
        endUserId: conv.endUserId,
        targetLanguage: target,
        customerLanguage: customerLanguage ?? conv.customerLanguage,
        count: eligible.length,
      },
    });
    return { saved: eligible.length };
  }

  private async loadConversation(conversationId: string): Promise<{
    orgId: string;
    endUserId: string | null;
    customerLanguage: string | null;
  }> {
    const ctx = getCurrentContext();
    const [conv] = await ctx.db
      .select({
        orgId: schema.convConversations.orgId,
        endUserId: schema.convConversations.endUserId,
        customerLanguage: schema.convConversations.customerLanguage,
      })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    if (!conv) throw new NotFoundException(`conv_not_found: conversation ${conversationId}`);
    return conv;
  }
}
