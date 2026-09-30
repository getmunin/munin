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

const CMS_ASSET_EXTENSIONS_BY_MIME: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg', 'jpe', 'jfif'],
  'image/jpg': ['jpg', 'jpeg', 'jpe', 'jfif'],
  'image/pjpeg': ['jpg', 'jpeg', 'jpe', 'jfif'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'image/bmp': ['bmp'],
  'image/tiff': ['tif', 'tiff'],
  'image/x-icon': ['ico'],
  'image/vnd.microsoft.icon': ['ico'],
  'video/mp4': ['mp4', 'm4v'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  'video/ogg': ['ogv', 'ogg'],
  'audio/mpeg': ['mp3', 'mpga'],
  'audio/mp3': ['mp3'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/x-m4a': ['m4a'],
  'audio/aac': ['aac'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/wave': ['wav'],
  'audio/ogg': ['ogg', 'oga', 'opus'],
  'audio/opus': ['opus'],
  'audio/webm': ['weba', 'webm'],
  'audio/flac': ['flac'],
  'application/pdf': ['pdf'],
};

export const CMS_ASSET_MIME_TYPES: readonly string[] = Object.keys(CMS_ASSET_EXTENSIONS_BY_MIME);

export const CMS_ASSET_TYPES_SUMMARY =
  'raster images (png, jpeg, gif, webp, avif, heic/heif, bmp, tiff, ico), video (mp4, webm, mov, ogv), audio (mp3, m4a, aac, wav, ogg/opus, weba, flac) and PDF';

export type CmsAssetTypeCheck =
  | { ok: true; mime: string; ext: string }
  | { ok: false; reason: 'mime_not_allowed' | 'extension_mismatch'; mime: string; ext: string | null };

function mimeFamily(mime: string): string {
  return mime === 'application/pdf' ? 'pdf' : mime.split('/')[0]!;
}

function extensionsForFamily(family: string): Set<string> {
  const exts = new Set<string>();
  for (const [mime, list] of Object.entries(CMS_ASSET_EXTENSIONS_BY_MIME)) {
    if (mimeFamily(mime) === family) for (const ext of list) exts.add(ext);
  }
  return exts;
}

export function checkCmsAssetType(name: string, rawMime: string): CmsAssetTypeCheck {
  const mime = normalizeMime(rawMime);
  const allowed = CMS_ASSET_EXTENSIONS_BY_MIME[mime];
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
  if (!allowed) return { ok: false, reason: 'mime_not_allowed', mime, ext };
  if (ext === null) return { ok: true, mime, ext: allowed[0]! };
  if (!extensionsForFamily(mimeFamily(mime)).has(ext)) {
    return { ok: false, reason: 'extension_mismatch', mime, ext };
  }
  return { ok: true, mime, ext };
}
