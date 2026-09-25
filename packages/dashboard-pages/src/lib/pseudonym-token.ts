const BARE = /^([a-z2-7]{8})$/i;
const WRAPPED = /(?:\b(?:contact|phone) |\bcontact-)([a-z2-7]{8})(?=$|[\s\]@])/i;

export function extractPseudonymToken(input: string): string | null {
  const trimmed = input.trim();
  const match = BARE.exec(trimmed) ?? WRAPPED.exec(trimmed);
  return match ? match[1]!.toLowerCase() : null;
}
