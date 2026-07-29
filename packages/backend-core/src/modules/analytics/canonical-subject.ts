export interface CanonicalSubjectOptions {
  locales: readonly string[];
  stripTrailingSlash: boolean;
}

export function canonicalizeSubjectId(
  subjectId: string,
  opts: CanonicalSubjectOptions,
): string {
  if (!subjectId.startsWith('/')) return subjectId;

  let out = subjectId;
  const locales = opts.locales
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0);
  if (locales.length > 0) {
    const match = /^\/([^/?#]+)(\/.*)?$/.exec(out);
    if (match && locales.includes(match[1]!.toLowerCase())) {
      out = match[2] ?? '/';
    }
  }

  if (opts.stripTrailingSlash && out.length > 1) {
    out = out.replace(/\/+$/, '') || '/';
  }
  return out;
}
