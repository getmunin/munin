const URL_TOKEN = /\b(?:https?:\/\/|www\.)\S+/gi;
const SUBJECT_REPLY_PREFIX = /^(?:(?:re|sv|svar|aw|fwd?|vs|vb)\s*:\s*)+/i;

const MACHINE_SUBJECT_PATTERNS: RegExp[] = [
  /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\.?$/,
  /^\d{1,2}\s+\p{L}+\.?\s+\d{4}\s*(?:г\.|г)?$/u,
  /^\p{L}+\.?\s+\d{1,2},?\s+\d{4}$/u,
  /^(?:screenshot|skjermbilde|screen\s?shot|скриншот|снимок экрана)\b/iu,
  /^(?:img|image|photo|picture|bilde|foto|фото|изображение)[\s_-]*(?:attachment|vedlegg)?[\s_-]*\d*$/iu,
  /^(?:dsc|img|pxl|photo)[\s_-]?\d+$/i,
  /^[\s\p{P}\p{S}]*$/u,
];

export function isContentlessBody(bodyText: string | null | undefined): boolean {
  if (!bodyText) return true;
  const withoutUrls = bodyText.replace(URL_TOKEN, ' ');
  return !/\p{L}|\p{N}/u.test(withoutUrls);
}

export function isMachineSubject(subject: string | null | undefined): boolean {
  const trimmed = (subject ?? '').trim();
  if (trimmed.length === 0) return true;
  const stripped = trimmed.replace(SUBJECT_REPLY_PREFIX, '').trim();
  if (stripped.length === 0) return true;
  if (isContentlessBody(stripped)) return true;
  return MACHINE_SUBJECT_PATTERNS.some((pattern) => pattern.test(stripped));
}

export function hasNoAnswerableContent(input: {
  subject: string | null | undefined;
  bodyText: string | null | undefined;
}): boolean {
  return isContentlessBody(input.bodyText) && isMachineSubject(input.subject);
}
