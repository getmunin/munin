import { normalizeMime } from '../../../common/storage/asset-validation.ts';
import { probeMaster } from '../../cms/cms.variants.ts';
import {
  CONV_ATTACHMENT_BYTES_MAX,
  CONV_ATTACHMENT_INBOUND_BYTES_MIN,
  CONV_ATTACHMENT_INBOUND_EDGE_MIN_PX,
  CONV_ATTACHMENT_MIME_ALLOWLIST,
  CONV_ATTACHMENT_PER_MESSAGE_MAX,
} from '../attachments/conv-attachments.constants.ts';

export interface InboundEmailAttachment {
  content: Buffer;
  contentType: string;
  filename: string | null;
  cid: string | null;
  contentDisposition: string | null;
  related: boolean;
}

export type InboundAttachmentDropReason =
  | 'mime_rejected'
  | 'too_large'
  | 'too_small'
  | 'unreferenced_cid'
  | 'undecodable'
  | 'edge_too_small'
  | 'per_message_max';

export interface KeptInboundAttachment {
  name: string;
  mime: string;
  content: Buffer;
  width: number;
  height: number;
  inline: boolean;
  contentId: string | null;
}

export interface DroppedInboundAttachment {
  name: string;
  mime: string;
  sizeBytes: number;
  reason: InboundAttachmentDropReason;
}

export interface InboundAttachmentFilterResult {
  kept: KeptInboundAttachment[];
  dropped: DroppedInboundAttachment[];
}

export type InboundImageProbe = (
  body: Buffer,
) => Promise<{ width: number; height: number } | null>;

export const probeInboundImage: InboundImageProbe = async (body) => {
  try {
    return await probeMaster(body);
  } catch {
    return null;
  }
};

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const NAME_MAX_LENGTH = 120;

export function normalizeCid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^</, '').replace(/>$/, '').trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export function collectCidReferences(html: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!html) return out;
  const pattern = /cid:([^"'\s)>\\]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const cid = normalizeCid(decodeCidToken(match[1]!));
    if (cid) out.add(cid);
  }
  return out;
}

export function normalizeCidReferences(
  html: string | null,
  keptCids: ReadonlySet<string>,
): string | null {
  if (!html) return html;
  const normalized = html.replace(/cid:([^"'\s)>\\]+)/gi, (whole, token: string) => {
    const cid = normalizeCid(decodeCidToken(token));
    return cid && keptCids.has(cid) ? `cid:${cid}` : whole;
  });
  return dropDanglingCidImages(normalized, keptCids);
}

export function inboundAttachmentName(
  part: Pick<InboundEmailAttachment, 'filename' | 'contentType'>,
  index: number,
): string {
  const ext = MIME_EXTENSIONS[normalizeMime(part.contentType)] ?? 'bin';
  const raw = (part.filename ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = [...raw]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && ch !== '"';
    })
    .join('')
    .trim();
  const stem = cleaned.replace(/\.[^.]{1,16}$/, '').trim().slice(0, NAME_MAX_LENGTH);
  return stem ? `${stem}.${ext}` : `image-${index + 1}.${ext}`;
}

export async function filterInboundAttachments(
  parts: readonly InboundEmailAttachment[],
  opts: { html: string | null; probe?: InboundImageProbe },
): Promise<InboundAttachmentFilterResult> {
  const probe = opts.probe ?? probeInboundImage;
  const referenced = collectCidReferences(opts.html);
  const hasHtmlBody = !!opts.html && opts.html.trim().length > 0;

  const kept: KeptInboundAttachment[] = [];
  const dropped: DroppedInboundAttachment[] = [];

  for (const [index, part] of parts.entries()) {
    const mime = normalizeMime(part.contentType);
    const name = inboundAttachmentName(part, index);
    const sizeBytes = part.content.length;
    const drop = (reason: InboundAttachmentDropReason): void => {
      dropped.push({ name, mime, sizeBytes, reason });
    };

    if (!CONV_ATTACHMENT_MIME_ALLOWLIST.includes(mime)) {
      drop('mime_rejected');
      continue;
    }
    if (sizeBytes > CONV_ATTACHMENT_BYTES_MAX) {
      drop('too_large');
      continue;
    }
    if (sizeBytes < CONV_ATTACHMENT_INBOUND_BYTES_MIN) {
      drop('too_small');
      continue;
    }

    const cid = normalizeCid(part.cid);
    const declaredInline =
      part.related || (part.contentDisposition ?? '').trim().toLowerCase() === 'inline';
    if (declaredInline && cid && hasHtmlBody && !referenced.has(cid)) {
      drop('unreferenced_cid');
      continue;
    }

    const dimensions = await probe(part.content);
    if (!dimensions) {
      drop('undecodable');
      continue;
    }
    if (
      dimensions.width < CONV_ATTACHMENT_INBOUND_EDGE_MIN_PX ||
      dimensions.height < CONV_ATTACHMENT_INBOUND_EDGE_MIN_PX
    ) {
      drop('edge_too_small');
      continue;
    }

    if (kept.length >= CONV_ATTACHMENT_PER_MESSAGE_MAX) {
      drop('per_message_max');
      continue;
    }

    const inline = declaredInline && cid != null && referenced.has(cid);
    kept.push({
      name,
      mime,
      content: part.content,
      width: dimensions.width,
      height: dimensions.height,
      inline,
      contentId: inline ? cid : null,
    });
  }

  return { kept, dropped };
}

function decodeCidToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function dropDanglingCidImages(html: string, keptCids: ReadonlySet<string>): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const refs = collectCidReferences(tag);
    if (refs.size === 0) return tag;
    return [...refs].every((cid) => keptCids.has(cid)) ? tag : '';
  });
}
