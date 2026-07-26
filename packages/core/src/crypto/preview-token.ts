import { signHmac, timingSafeEqual } from './primitives.ts';

const VERSION = 'pv1';

const DEFAULT_MAX_AGE_SECONDS = 60 * 60;
const FUTURE_SKEW_SECONDS = 5 * 60;

export const PREVIEW_TOKEN_MAX_AGE_SECONDS = DEFAULT_MAX_AGE_SECONDS;

export interface PreviewTokenPayload {
  orgId: string;
  entryId: string;
  issuedAt: number;
}

export class PreviewTokenError extends Error {
  readonly code = 'preview_token_invalid';
  constructor(message: string) {
    super(`preview_token_invalid: ${message}`);
  }
}

export function signPreviewToken(
  payload: Omit<PreviewTokenPayload, 'issuedAt'> & { issuedAt?: number },
  pepper?: string,
): string {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new Error('MUNIN_KEY_PEPPER is required to sign preview tokens');
  const issuedAt = payload.issuedAt ?? Math.floor(Date.now() / 1000);
  for (const v of [payload.orgId, payload.entryId]) {
    if (!v || /[.\s]/.test(v)) {
      throw new Error('preview token fields must be non-empty and contain no dots or whitespace');
    }
  }
  const body = `${VERSION}.${payload.orgId}.${payload.entryId}.${issuedAt}`;
  const sig = signHmac(body, secret);
  return `${body}.${sig}`;
}

export function verifyPreviewToken(
  token: string,
  pepper?: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): PreviewTokenPayload {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new PreviewTokenError('server pepper not configured');
  const parts = token.split('.');
  if (parts.length !== 5) throw new PreviewTokenError('malformed token');
  const [version, orgId, entryId, issuedAtStr, sig] = parts;
  if (version !== VERSION) throw new PreviewTokenError(`unknown version ${version}`);
  const body = `${version}.${orgId}.${entryId}.${issuedAtStr}`;
  const expected = signHmac(body, secret);
  if (!timingSafeEqual(expected, sig!)) throw new PreviewTokenError('signature mismatch');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) throw new PreviewTokenError('issuedAt not numeric');
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + FUTURE_SKEW_SECONDS) throw new PreviewTokenError('issuedAt in the future');
  if (now - issuedAt > maxAgeSeconds) throw new PreviewTokenError('token expired');
  return { orgId: orgId!, entryId: entryId!, issuedAt };
}
