import { signHmac, timingSafeEqual } from './crypto.js';

const VERSION = 'v1';

export interface EmailOpenTokenPayload {
  orgId: string;
  deliveryId: string;
  issuedAt: number;
}

export class EmailOpenTokenError extends Error {
  readonly code = 'email_open_token_invalid';
  constructor(message: string) {
    super(`email_open_token_invalid: ${message}`);
  }
}

export function signEmailOpenToken(
  payload: Omit<EmailOpenTokenPayload, 'issuedAt'> & { issuedAt?: number },
  pepper?: string,
): string {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new Error('MUNIN_KEY_PEPPER is required to sign email open tokens');
  const issuedAt = payload.issuedAt ?? Math.floor(Date.now() / 1000);
  for (const v of [payload.orgId, payload.deliveryId]) {
    if (!v || /[.\s]/.test(v)) {
      throw new Error('email open token fields must be non-empty and contain no dots or whitespace');
    }
  }
  const body = `${VERSION}.${payload.orgId}.${payload.deliveryId}.${issuedAt}`;
  const sig = signHmac(body, secret);
  return `${body}.${sig}`;
}

export function verifyEmailOpenToken(token: string, pepper?: string): EmailOpenTokenPayload {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new EmailOpenTokenError('server pepper not configured');
  const parts = token.split('.');
  if (parts.length !== 5) throw new EmailOpenTokenError('malformed token');
  const [version, orgId, deliveryId, issuedAtStr, sig] = parts;
  if (version !== VERSION) throw new EmailOpenTokenError(`unknown version ${version}`);
  const body = `${version}.${orgId}.${deliveryId}.${issuedAtStr}`;
  const expected = signHmac(body, secret);
  if (!timingSafeEqual(expected, sig!)) throw new EmailOpenTokenError('signature mismatch');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) throw new EmailOpenTokenError('issuedAt not numeric');
  return { orgId: orgId!, deliveryId: deliveryId!, issuedAt };
}
