export const CONV_ATTACHMENT_MIME_ALLOWLIST: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

export const CONV_ATTACHMENT_BYTES_MAX = 10 * 1024 * 1024;

export const CONV_ATTACHMENT_PER_MESSAGE_MAX = 10;

export const CONV_ATTACHMENT_PENDING_PER_SESSION_MAX = 10;

export const CONV_ATTACHMENT_INBOUND_BYTES_MIN = 4 * 1024;

export const CONV_ATTACHMENT_INBOUND_EDGE_MIN_PX = 32;
