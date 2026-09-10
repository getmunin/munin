export const CONV_ATTACHMENT_MIME_ALLOWLIST: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

export const CONV_ATTACHMENT_BYTES_MAX = 10 * 1024 * 1024;

export const CONV_ATTACHMENT_PER_MESSAGE_MAX = 10;

export const CONV_ATTACHMENT_MB_MAX = Math.floor(CONV_ATTACHMENT_BYTES_MAX / (1024 * 1024));

export type AttachmentRejection = 'mime' | 'too_large' | 'too_many';

export function normalizeAttachmentMime(mime: string): string {
  return mime.trim().toLowerCase().split(';')[0]!.trim();
}

export function isAllowedAttachmentMime(mime: string): boolean {
  return CONV_ATTACHMENT_MIME_ALLOWLIST.includes(normalizeAttachmentMime(mime));
}

export function attachmentRejectionFor(candidate: {
  mime: string;
  sizeBytes: number;
}): AttachmentRejection | null {
  if (!isAllowedAttachmentMime(candidate.mime)) return 'mime';
  if (candidate.sizeBytes > CONV_ATTACHMENT_BYTES_MAX) return 'too_large';
  return null;
}
