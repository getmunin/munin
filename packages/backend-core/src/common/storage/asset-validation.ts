export function assetExtensionFromName(name: string): string {
  return (name.split('.').pop() ?? 'bin').toLowerCase().slice(0, 16);
}

export function normalizeMime(mime: string): string {
  return mime.trim().toLowerCase().split(';')[0]!.trim();
}

export function isSvgMime(mime: string): boolean {
  const normalized = normalizeMime(mime);
  return normalized === 'image/svg+xml' || normalized === 'image/svg';
}

export function isSvgAsset(ext: string, mime: string): boolean {
  return ext === 'svg' || isSvgMime(mime);
}

export function randomKeySegment(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
