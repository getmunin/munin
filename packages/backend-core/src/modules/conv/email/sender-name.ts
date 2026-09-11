const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export function senderDisplayName(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed || !HAS_LETTER_OR_DIGIT.test(trimmed)) return null;
  return trimmed;
}
