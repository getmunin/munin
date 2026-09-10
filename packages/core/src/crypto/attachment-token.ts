import { signHmac, timingSafeEqual } from './primitives.ts';

const VERSION = 'av1';

export const ATTACHMENT_TOKEN_MAX_AGE_SECONDS = 60 * 60;
const FUTURE_SKEW_SECONDS = 5 * 60;

export interface AttachmentTokenPayload {
  orgId: string;
  attachmentId: string;
  issuedAt: number;
}

export class AttachmentTokenError extends Error {
  readonly code = 'attachment_token_invalid';
  constructor(message: string) {
    super(`attachment_token_invalid: ${message}`);
  }
}

export function signAttachmentToken(
  payload: Omit<AttachmentTokenPayload, 'issuedAt'> & { issuedAt?: number },
  pepper?: string,
): string {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new Error('MUNIN_KEY_PEPPER is required to sign attachment tokens');
  const issuedAt = payload.issuedAt ?? Math.floor(Date.now() / 1000);
  for (const v of [payload.orgId, payload.attachmentId]) {
    if (!v || /[.\s]/.test(v)) {
      throw new Error('attachment token fields must be non-empty and contain no dots or whitespace');
    }
  }
  const body = `${VERSION}.${payload.orgId}.${payload.attachmentId}.${issuedAt}`;
  const sig = signHmac(body, secret);
  return `${body}.${sig}`;
}

export function verifyAttachmentToken(
  token: string,
  pepper?: string,
  maxAgeSeconds: number = ATTACHMENT_TOKEN_MAX_AGE_SECONDS,
): AttachmentTokenPayload {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new AttachmentTokenError('server pepper not configured');
  const parts = token.split('.');
  if (parts.length !== 5) throw new AttachmentTokenError('malformed token');
  const [version, orgId, attachmentId, issuedAtStr, sig] = parts;
  if (version !== VERSION) throw new AttachmentTokenError(`unknown version ${version}`);
  const body = `${version}.${orgId}.${attachmentId}.${issuedAtStr}`;
  const expected = signHmac(body, secret);
  if (!timingSafeEqual(expected, sig!)) throw new AttachmentTokenError('signature mismatch');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) throw new AttachmentTokenError('issuedAt not numeric');
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + FUTURE_SKEW_SECONDS) throw new AttachmentTokenError('issuedAt in the future');
  if (now - issuedAt > maxAgeSeconds) throw new AttachmentTokenError('token expired');
  return { orgId: orgId!, attachmentId: attachmentId!, issuedAt };
}
