import type { ConversationDetail, MessageDto } from './inbox-types';

const NORWEGIAN = new Set(['nb', 'nn', 'no']);
const TRANSLATABLE_AUTHORS = new Set<MessageDto['authorType']>(['end_user', 'agent', 'user']);

export function sameLanguage(a: string, b: string): boolean {
  const primaryA = a.toLowerCase().split('-')[0]!;
  const primaryB = b.toLowerCase().split('-')[0]!;
  return primaryA === primaryB || (NORWEGIAN.has(primaryA) && NORWEGIAN.has(primaryB));
}

function isTranslatable(message: MessageDto): boolean {
  return (
    !message.internal && TRANSLATABLE_AUTHORS.has(message.authorType) && message.body.trim() !== ''
  );
}

function translationsIn(
  detail: ConversationDetail,
  locale: string,
): Record<string, string> | null {
  const translations = detail.translations;
  if (!translations || !sameLanguage(translations.targetLanguage, locale)) return null;
  return translations.messages;
}

export function customerSpeaksViewerLanguage(detail: ConversationDetail, locale: string): boolean {
  return !!detail.customerLanguage && sameLanguage(detail.customerLanguage, locale);
}

function draftNeedsTranslation(
  detail: ConversationDetail,
  draft: MessageDto,
  locale: string,
): boolean {
  const tagged = draft.metadata?.['language'];
  const language = typeof tagged === 'string' && tagged ? tagged : detail.customerLanguage;
  return !!language && !sameLanguage(language, locale);
}

export function draftAwaitsTranslation(
  detail: ConversationDetail,
  draft: MessageDto,
  locale: string,
): boolean {
  return (
    draftNeedsTranslation(detail, draft, locale) && !(draft.id in (translationsIn(detail, locale) ?? {}))
  );
}

export function draftInViewerLanguage(
  detail: ConversationDetail,
  draft: MessageDto,
  locale: string,
): MessageDto {
  const translated = translationsIn(detail, locale)?.[draft.id];
  return translated === undefined || !draftNeedsTranslation(detail, draft, locale)
    ? draft
    : { ...draft, body: translated };
}

export function untranslatedMessageIds(
  detail: ConversationDetail,
  locale: string,
  draft: MessageDto | null = null,
): string[] {
  const done = translationsIn(detail, locale) ?? {};
  const thread = customerSpeaksViewerLanguage(detail, locale)
    ? []
    : detail.messages.filter((m) => isTranslatable(m) && !(m.id in done)).map((m) => m.id);
  return draft && draftAwaitsTranslation(detail, draft, locale) ? [...thread, draft.id] : thread;
}

export function threadTranslations(
  detail: ConversationDetail,
  locale: string,
): Record<string, string> | null {
  if (!detail.customerLanguage || customerSpeaksViewerLanguage(detail, locale)) return null;
  const messages = translationsIn(detail, locale);
  if (!messages) return null;
  const changed = detail.messages.some(
    (m) => m.id in messages && messages[m.id]!.trim() !== m.body.trim(),
  );
  return changed ? messages : null;
}

export function languageLabel(tag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function viewerLanguageName(locale: string): string {
  const primary = locale.toLowerCase().split('-')[0]!;
  return languageLabel(NORWEGIAN.has(primary) ? 'no' : locale, locale);
}
