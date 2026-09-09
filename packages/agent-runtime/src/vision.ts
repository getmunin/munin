import type { ChatImage, ConversationAttachment } from './types.ts';

export const VISION_MAX_IMAGES_PER_TURN = 3;
export const VISION_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const VISION_MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const VISION_IMAGE_HISTORY_CHAR_COST = 2_000;

export const VISION_SUPPORTED_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

const VISION_CAPABLE_MODEL_PATTERNS: readonly RegExp[] = [
  /^claude-3/,
  /^claude-(?:opus|sonnet|haiku|fable|mythos)-/,
  /^gpt-4o/,
  /^gpt-4\.1/,
  /^gpt-4-turbo/,
  /^gpt-5/,
  /^o[34](?:-|$)/,
  /^gemini-(?:1\.5|[2-9])/,
  /^pixtral/,
  /vision/,
];

export function normalizeModelId(model: string): string {
  const withoutVendor = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  return (withoutVendor.split(':')[0] ?? '').trim().toLowerCase();
}

export function modelSupportsVision(model: string): boolean {
  const id = normalizeModelId(model);
  if (id.length === 0) return false;
  return VISION_CAPABLE_MODEL_PATTERNS.some((pattern) => pattern.test(id));
}

export function isSupportedImageMime(mime: string): boolean {
  return VISION_SUPPORTED_MIME_TYPES.includes(mime.trim().toLowerCase());
}

export function attachmentLabel(attachment: ConversationAttachment): string {
  const name = attachment.name?.trim();
  if (name) return name;
  const subtype = attachment.mime.split('/')[1];
  return subtype ? `image.${subtype}` : 'attachment';
}

export function attachmentPlaceholder(
  attachment: ConversationAttachment,
  reason?: string,
): string {
  const label = attachmentLabel(attachment);
  return reason
    ? `[customer attached ${label} — ${reason}]`
    : `[customer attached ${label}]`;
}

export function imageBudgetChars(attachmentCount: number): number {
  return Math.min(attachmentCount, VISION_MAX_IMAGES_PER_TURN) * VISION_IMAGE_HISTORY_CHAR_COST;
}

export interface TurnImages {
  images: ChatImage[];
  notes: string[];
}

export type ImageFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface LoadHistoryImagesOptions {
  visionEnabled: boolean;
  fetch?: ImageFetch;
  maxImagesPerTurn?: number;
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
}

interface AttachmentCarrier {
  attachments?: ConversationAttachment[];
  imagesAllowed?: boolean;
}

export async function loadHistoryImages(
  history: readonly AttachmentCarrier[],
  options: LoadHistoryImagesOptions,
): Promise<TurnImages[]> {
  const perTurnMax = options.maxImagesPerTurn ?? VISION_MAX_IMAGES_PER_TURN;
  const perImageMax = options.maxImageBytes ?? VISION_MAX_IMAGE_BYTES;
  const totalMax = options.maxTotalImageBytes ?? VISION_MAX_TOTAL_IMAGE_BYTES;
  const fetchImage = options.fetch ?? defaultImageFetch;

  const turns: TurnImages[] = history.map(() => ({ images: [], notes: [] }));
  let spent = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const carrier = history[index];
    const attachments = carrier?.attachments ?? [];
    const turn = turns[index];
    if (!carrier || !turn || attachments.length === 0) continue;
    const imagesAllowed = options.visionEnabled && (carrier.imagesAllowed ?? true);

    for (const attachment of attachments) {
      if (!imagesAllowed) {
        turn.notes.push(attachmentPlaceholder(attachment));
        continue;
      }
      if (!attachment.url || !isSupportedImageMime(attachment.mime)) {
        turn.notes.push(attachmentPlaceholder(attachment));
        continue;
      }
      if (turn.images.length >= perTurnMax || spent >= totalMax) {
        turn.notes.push(attachmentPlaceholder(attachment, 'not shown, image limit reached'));
        continue;
      }

      const limit = Math.min(perImageMax, totalMax - spent);
      const loaded = await fetchImageBytes(fetchImage, attachment.url, limit);
      if ('failure' in loaded) {
        turn.notes.push(attachmentPlaceholder(attachment, loaded.failure));
        continue;
      }
      turn.images.push({ mime: attachment.mime.trim().toLowerCase(), base64: loaded.base64 });
      spent += loaded.bytes;
    }
  }

  return turns;
}

type FetchedImage = { base64: string; bytes: number } | { failure: string };

async function fetchImageBytes(
  fetchImage: ImageFetch,
  url: string,
  limitBytes: number,
): Promise<FetchedImage> {
  let res: Awaited<ReturnType<ImageFetch>>;
  try {
    res = await fetchImage(url);
  } catch {
    return { failure: 'could not be loaded' };
  }

  if (!res.ok) {
    return { failure: res.status === 404 ? 'no longer available' : 'could not be loaded' };
  }

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limitBytes) {
    return { failure: 'too large to show' };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { failure: 'could not be loaded' };
  }
  if (bytes.byteLength === 0) return { failure: 'could not be loaded' };
  if (bytes.byteLength > limitBytes) return { failure: 'too large to show' };

  return { base64: Buffer.from(bytes).toString('base64'), bytes: bytes.byteLength };
}

const defaultImageFetch: ImageFetch = (url) => globalThis.fetch(url);
