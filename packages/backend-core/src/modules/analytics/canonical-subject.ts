export interface CanonicalSubjectContext {
  locale?: string | null;
  localeOverrides?: readonly string[];
}

export function canonicalizeSubjectId(
  subjectId: string,
  ctx: CanonicalSubjectContext = {},
): string {
  if (!subjectId.startsWith('/')) return subjectId;

  let out = subjectId;
  const match = /^\/([^/?#]+)(\/.*)?$/.exec(out);
  if (match && isLocaleSegment(match[1]!, ctx)) {
    out = match[2] ?? '/';
  }

  if (out.length > 1) out = out.replace(/\/+$/, '') || '/';
  return out;
}

function isLocaleSegment(segment: string, ctx: CanonicalSubjectContext): boolean {
  const candidate = segment.toLowerCase();
  for (const override of ctx.localeOverrides ?? []) {
    if (override.trim().toLowerCase() === candidate) return true;
  }
  const locale = ctx.locale?.trim().toLowerCase();
  if (!locale) return false;
  return candidate === locale || candidate === locale.split(/[-_]/)[0];
}
