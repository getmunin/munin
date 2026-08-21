export function readLiveUrlTemplate(settings: Record<string, unknown>): string | null {
  const v = (settings as { liveUrl?: unknown }).liveUrl;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function renderLiveUrl(
  template: string | null,
  entry: { slug: string; locale: string; collectionSlug: string },
): string | null {
  if (!template) return null;
  const substituted = template
    .replaceAll('{slug}', encodeURIComponent(entry.slug))
    .replaceAll('{locale}', encodeURIComponent(entry.locale))
    .replaceAll('{collection}', encodeURIComponent(entry.collectionSlug));
  let parsed: URL;
  try {
    parsed = new URL(substituted);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

const TITLE_FIELD_NAMES = ['title', 'headline', 'name', 'heading'];

export function entryTitle(data: Record<string, unknown>, slug: string): string {
  for (const name of TITLE_FIELD_NAMES) {
    const value = data[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return slug;
}
