export const NAME_WORD_PATTERN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

const NON_PERSON_WORDS: ReadonlySet<string> = new Set([
  'admin',
  'bestilling',
  'contact',
  'customer',
  'dear',
  'email',
  'faktura',
  'god',
  'hallo',
  'hei',
  'hej',
  'hello',
  'hi',
  'hilsen',
  'info',
  'invoice',
  'kjære',
  'kontakt',
  'kunde',
  'kundeservice',
  'mail',
  'mvh',
  'name',
  'noreply',
  'order',
  'phone',
  'post',
  'regards',
  'reply',
  'sales',
  'salg',
  'service',
  'support',
  'takk',
  'team',
  'thanks',
]);

export function nameWords(text: string): string[] {
  return [...text.normalize('NFC').matchAll(NAME_WORD_PATTERN)].map((m) => m[0].toLowerCase());
}

export function normalizeName(text: string): string {
  return nameWords(text).join(' ');
}

export function isPersonNameCandidate(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return false;
  if (/[@\d]/.test(trimmed)) return false;
  const words = nameWords(trimmed);
  if (words.length === 0) return false;
  return !words.every((w) => NON_PERSON_WORDS.has(w));
}

export function isPersonNameWord(word: string): boolean {
  return word.length >= 2 && !NON_PERSON_WORDS.has(word);
}
