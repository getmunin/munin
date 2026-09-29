import { BadRequestException } from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { inArray } from 'drizzle-orm';

const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const NORWEGIAN = new Set(['nb', 'nn', 'no']);
export const TRANSLATABLE_AUTHORS = ['end_user', 'agent', 'user'] as const;

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
