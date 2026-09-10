import { randomUUID } from 'node:crypto';
import { normalizeMime } from '../../../common/storage/asset-validation.ts';
import {
  CONV_ATTACHMENT_BYTES_MAX,
  CONV_ATTACHMENT_INBOUND_BYTES_MIN,
  CONV_ATTACHMENT_MIME_ALLOWLIST,
  CONV_ATTACHMENT_PER_MESSAGE_MAX,
} from './conv-attachments.constants.ts';

const DATA_URI_RE = /data:(image\/[a-z0-9.+-]{1,32});base64,([A-Za-z0-9+/=]+)/gi;

export interface ExtractedInlineImage {
  mime: string;
  body: Buffer;
  contentId: string;
  name: string;
}

export interface InlineExtraction {
  html: string;
  images: ExtractedInlineImage[];
  skipped: number;
}

export function extractDataUriImages(html: string, messageId: string): InlineExtraction {
  const images: ExtractedInlineImage[] = [];
  let skipped = 0;
  let index = 0;

  const rewritten = html.replace(DATA_URI_RE, (match, rawMime: string, base64: string) => {
    const mime = normalizeMime(rawMime);
    if (!CONV_ATTACHMENT_MIME_ALLOWLIST.includes(mime)) {
      skipped += 1;
      return match;
    }
    if (images.length >= CONV_ATTACHMENT_PER_MESSAGE_MAX) {
      skipped += 1;
      return match;
    }

    let body: Buffer;
    try {
      body = Buffer.from(base64, 'base64');
    } catch {
      skipped += 1;
      return match;
    }
    if (body.length < CONV_ATTACHMENT_INBOUND_BYTES_MIN || body.length > CONV_ATTACHMENT_BYTES_MAX) {
      skipped += 1;
      return match;
    }

    index += 1;
    const contentId = `munin-inline-${messageId}-${index}-${randomUUID().slice(0, 8)}`;
    images.push({
      mime,
      body,
      contentId,
      name: `inline-${index}.${extensionFor(mime)}`,
    });
    return `cid:${contentId}`;
  });

  return { html: rewritten, images, skipped };
}

export function htmlHasDataUriImage(html: string | null | undefined): boolean {
  if (!html) return false;
  DATA_URI_RE.lastIndex = 0;
  return DATA_URI_RE.test(html);
}

function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}
