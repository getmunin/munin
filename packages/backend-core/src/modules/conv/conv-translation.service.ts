import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';

const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const NORWEGIAN = new Set(['nb', 'nn', 'no']);
const TRANSLATABLE_AUTHORS = ['end_user', 'agent', 'user'] as const;

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

export function normalizeLanguageTag(tag: string): string {
  const normalized = tag.trim().toLowerCase().replace(/_/g, '-');
  if (!LANGUAGE_TAG.test(normalized)) {
    throw new BadRequestException(
      `conv_invalid: ${JSON.stringify(tag)} is not a language tag such as "en", "nb" or "pt-br"`,
    );
  }
  return normalized;
}

export function sameLanguage(a: string, b: string): boolean {
  const primaryA = a.split('-')[0]!;
  const primaryB = b.split('-')[0]!;
  return primaryA === primaryB || (NORWEGIAN.has(primaryA) && NORWEGIAN.has(primaryB));
}

export async function deleteMessageTranslations(
  db: Db | Tx,
  messageIds: readonly string[],
): Promise<void> {
  if (messageIds.length === 0) return;
  await db
    .delete(schema.convMessageTranslations)
    .where(inArray(schema.convMessageTranslations.messageId, [...messageIds]));
}

@Injectable()
export class ConvTranslationService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

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
    return {
      ...base,
      messages: rows.map((r) => ({
        id: r.id,
        authorType: r.authorType as PendingTranslationMessage['authorType'],
        body: r.body,
      })),
    };
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
                eq(schema.convMessages.internal, false),
                inArray(schema.convMessages.authorType, [...TRANSLATABLE_AUTHORS]),
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
