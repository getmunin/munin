export function normalizeForCompare(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function sameAfterNormalizing(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}
