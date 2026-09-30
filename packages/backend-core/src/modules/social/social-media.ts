import { Injectable } from '@nestjs/common';
import { safeFetch, SsrfBlockedError } from '@getmunin/core';
import sharp from 'sharp';
import type { SocialMediaKind } from './social-platform.ts';

export interface FetchedMedia {
  kind: SocialMediaKind;
  contentType: string;
  bytes: Buffer;
  sourceUrl: string;
}

export interface OpenGraphSummary {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

export class SocialMediaError extends Error {}

const PAGE_TIMEOUT_MS = 10_000;
const MEDIA_TIMEOUT_MS = 120_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const META_TAG = /<meta\b[^>]{0,2000}>/gi;
const ATTR = /\b(property|name|content)\s*=\s*("([^"]{0,2000})"|'([^']{0,2000})'|([^\s"'>]{1,2000}))/gi;

function attributesOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(tag)) !== null) {
    const key = match[1]!.toLowerCase();
    out[key] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return out;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

export function extractOpenGraph(html: string, baseUrl: string): OpenGraphSummary {
  const found = new Map<string, string>();
  META_TAG.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = META_TAG.exec(html)) !== null) {
    const attrs = attributesOf(tag[0]);
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    const content = attrs.content;
    if (!key || content === undefined || content === '') continue;
    if (!found.has(key)) found.set(key, decodeEntities(content).trim());
  }
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = found.get(key);
      if (value) return value;
    }
    return null;
  };
  const image = pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image');
  let imageUrl: string | null = null;
  if (image) {
    try {
      const resolved = new URL(image, baseUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        imageUrl = resolved.toString();
      }
    } catch {
      imageUrl = null;
    }
  }
  return {
    title: pick('og:title', 'twitter:title'),
    description: pick('og:description', 'twitter:description', 'description'),
    imageUrl,
  };
}

export interface SocialFetchResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type SocialFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<SocialFetchResponse>;

const defaultSocialFetch: SocialFetch = (url, init) => safeFetch(url, init);

function isSsrfBlock(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 4; depth += 1) {
    if (cur instanceof SsrfBlockedError) return true;
    if (cur instanceof Error && (cur as NodeJS.ErrnoException).code === 'ESSRF_BLOCKED') return true;
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return false;
}

async function fetchPublic(
  rawUrl: string,
  timeoutMs: number,
  fetcher: SocialFetch,
): Promise<SocialFetchResponse> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SocialMediaError(`${rawUrl} is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SocialMediaError(`${parsed.protocol} is not a fetchable scheme`);
  }
  try {
    return await fetcher(parsed.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Munin/1.0 (+https://getmunin.com)' },
    });
  } catch (err) {
    if (isSsrfBlock(err)) {
      throw new SocialMediaError(`${rawUrl} is not an allowed destination`);
    }
    throw new SocialMediaError(`could not fetch ${rawUrl}`);
  }
}

async function refuse(res: SocialFetchResponse, message: string): Promise<never> {
  await res.body?.cancel().catch(() => undefined);
  throw new SocialMediaError(message);
}

async function readCapped(
  res: SocialFetchResponse,
  maxBytes: number,
  what: string,
): Promise<Buffer> {
  const declared = Number.parseInt(res.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new SocialMediaError(
      `${what} is ${Math.round(declared / 1024 / 1024)}MB, over the ${Math.round(maxBytes / 1024 / 1024)}MB limit`,
    );
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read().catch(() => {
        throw new SocialMediaError(`${what} could not be read`);
      });
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SocialMediaError(
          `${what} is over the ${Math.round(maxBytes / 1024 / 1024)}MB limit`,
        );
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function fetchOpenGraph(
  pageUrl: string,
  fetcher: SocialFetch = defaultSocialFetch,
): Promise<OpenGraphSummary> {
  const res = await fetchPublic(pageUrl, PAGE_TIMEOUT_MS, fetcher);
  if (!res.ok) {
    await refuse(res, `${pageUrl} answered ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    await refuse(res, `${pageUrl} is ${contentType || 'not HTML'}`);
  }
  const html = (await readCapped(res, MAX_PAGE_BYTES, 'the page')).toString('utf8');
  return extractOpenGraph(html, res.url || pageUrl);
}

export function mediaKindFor(
  contentType: string,
  limits: { imageContentTypes: readonly string[]; videoContentTypes: readonly string[] },
): SocialMediaKind | null {
  const normalized = contentType.split(';')[0]!.trim().toLowerCase();
  if (limits.imageContentTypes.includes(normalized)) return 'image';
  if (limits.videoContentTypes.includes(normalized)) return 'video';
  return null;
}

export const TRANSCODABLE_IMAGE_TYPES = ['image/webp', 'image/avif', 'image/tiff'] as const;

const JPEG_QUALITY = 88;

export function transcodesToImage(
  contentType: string,
  limits: { imageContentTypes: readonly string[] },
): boolean {
  const normalized = contentType.split(';')[0]!.trim().toLowerCase();
  if (!TRANSCODABLE_IMAGE_TYPES.some((type) => type === normalized)) return false;
  if (limits.imageContentTypes.includes(normalized)) return false;
  return (
    limits.imageContentTypes.includes('image/jpeg') ||
    limits.imageContentTypes.includes('image/png')
  );
}

export async function transcodeImage(
  bytes: Buffer,
  args: { sourceType: string; imageContentTypes: readonly string[] },
): Promise<{ bytes: Buffer; contentType: string }> {
  const stats = await sharp(bytes)
    .stats()
    .catch((err: unknown) => {
      throw new SocialMediaError(
        `the ${args.sourceType} could not be decoded: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  const takesJpeg = args.imageContentTypes.includes('image/jpeg');
  const takesPng = args.imageContentTypes.includes('image/png');
  const toPng = takesPng && (!stats.isOpaque || !takesJpeg);
  const encoded = await (toPng
    ? sharp(bytes).png({ compressionLevel: 9 }).toBuffer()
    : sharp(bytes)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer()
  ).catch((err: unknown) => {
    throw new SocialMediaError(
      `the ${args.sourceType} could not be converted: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  return { bytes: encoded, contentType: toPng ? 'image/png' : 'image/jpeg' };
}

export async function fetchMedia(
  mediaUrl: string,
  args: {
    expectedKind?: SocialMediaKind | null;
    limits: {
      maxImageBytes: number;
      maxVideoBytes: number;
      imageContentTypes: readonly string[];
      videoContentTypes: readonly string[];
    };
  },
  fetcher: SocialFetch = defaultSocialFetch,
): Promise<FetchedMedia> {
  const res = await fetchPublic(mediaUrl, MEDIA_TIMEOUT_MS, fetcher);
  if (!res.ok) {
    await refuse(res, `${mediaUrl} answered ${res.status}`);
  }
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const needsTranscode = transcodesToImage(contentType, args.limits);
  const kind = needsTranscode ? 'image' : mediaKindFor(contentType, args.limits);
  if (!kind) {
    const accepted = [...args.limits.imageContentTypes, ...args.limits.videoContentTypes].join(', ');
    return refuse(
      res,
      `${mediaUrl} is ${contentType || 'of unknown type'}; the platform accepts ${accepted}`,
    );
  }
  if (args.expectedKind && args.expectedKind !== kind) {
    return refuse(res, `${mediaUrl} is ${contentType}, which is a ${kind}, not a ${args.expectedKind}`);
  }
  const maxBytes = kind === 'image' ? args.limits.maxImageBytes : args.limits.maxVideoBytes;
  const bytes = await readCapped(res, maxBytes, `the ${kind}`);
  if (bytes.length === 0) {
    throw new SocialMediaError(`${mediaUrl} returned an empty body`);
  }
  const sourceUrl = res.url || mediaUrl;
  if (!needsTranscode) return { kind, contentType, bytes, sourceUrl };

  const converted = await transcodeImage(bytes, {
    sourceType: contentType,
    imageContentTypes: args.limits.imageContentTypes,
  });
  if (converted.bytes.length > maxBytes) {
    throw new SocialMediaError(
      `${mediaUrl} is ${contentType}, and converting it to ${converted.contentType} came out over the ${Math.round(maxBytes / 1024 / 1024)}MB limit`,
    );
  }
  return { kind, contentType: converted.contentType, bytes: converted.bytes, sourceUrl };
}

export interface MediaFetchLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
  imageContentTypes: readonly string[];
  videoContentTypes: readonly string[];
}

export interface SocialMediaReader {
  fetchOpenGraph(pageUrl: string): Promise<OpenGraphSummary>;
  fetchMedia(
    mediaUrl: string,
    args: { expectedKind?: SocialMediaKind | null; limits: MediaFetchLimits },
  ): Promise<FetchedMedia>;
}

@Injectable()
export class SocialMediaFetcher implements SocialMediaReader {
  fetchOpenGraph(pageUrl: string): Promise<OpenGraphSummary> {
    return fetchOpenGraph(pageUrl);
  }

  fetchMedia(
    mediaUrl: string,
    args: { expectedKind?: SocialMediaKind | null; limits: MediaFetchLimits },
  ): Promise<FetchedMedia> {
    return fetchMedia(mediaUrl, args);
  }
}
