import { signHmac, timingSafeEqual } from './primitives.ts';

const VERSION = 'v1';

export interface UnsubscribeTokenPayload {
  orgId: string;
  contactId: string;
  campaignId: string;
  issuedAt: number;
}

export class UnsubscribeTokenError extends Error {
  readonly code = 'unsubscribe_token_invalid';
  constructor(message: string) {
    super(`unsubscribe_token_invalid: ${message}`);
  }
}

export function signUnsubscribeToken(
  payload: Omit<UnsubscribeTokenPayload, 'issuedAt'> & { issuedAt?: number },
  pepper?: string,
): string {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new Error('MUNIN_KEY_PEPPER is required to sign unsubscribe tokens');
  const issuedAt = payload.issuedAt ?? Math.floor(Date.now() / 1000);
  for (const v of [payload.orgId, payload.contactId, payload.campaignId]) {
    if (!v || /[.\s]/.test(v)) {
      throw new Error('unsubscribe token fields must be non-empty and contain no dots or whitespace');
    }
  }
  const body = `${VERSION}.${payload.orgId}.${payload.contactId}.${payload.campaignId}.${issuedAt}`;
  const sig = signHmac(body, secret);
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(token: string, pepper?: string): UnsubscribeTokenPayload {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new UnsubscribeTokenError('server pepper not configured');
  const parts = token.split('.');
  if (parts.length !== 6) throw new UnsubscribeTokenError('malformed token');
  const [version, orgId, contactId, campaignId, issuedAtStr, sig] = parts;
  if (version !== VERSION) throw new UnsubscribeTokenError(`unknown version ${version}`);
  const body = `${version}.${orgId}.${contactId}.${campaignId}.${issuedAtStr}`;
  const expected = signHmac(body, secret);
  if (!timingSafeEqual(expected, sig!)) throw new UnsubscribeTokenError('signature mismatch');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) throw new UnsubscribeTokenError('issuedAt not numeric');
  return { orgId: orgId!, contactId: contactId!, campaignId: campaignId!, issuedAt };
}
