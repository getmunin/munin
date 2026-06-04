import { signHmac, timingSafeEqual } from './primitives.ts';

const VERSION = 'v1';

export interface ViewTokenPayload {
  orgId: string;
  subjectType: string;
  subjectId: string;
  issuedAt: number;
}

export class ViewTokenError extends Error {
  readonly code = 'view_token_invalid';
  constructor(message: string) {
    super(`view_token_invalid: ${message}`);
  }
}

export function signViewToken(
  payload: Omit<ViewTokenPayload, 'issuedAt'> & { issuedAt?: number },
  pepper?: string,
): string {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new Error('MUNIN_KEY_PEPPER is required to sign view tokens');
  const issuedAt = payload.issuedAt ?? Math.floor(Date.now() / 1000);
  for (const v of [payload.orgId, payload.subjectType, payload.subjectId]) {
    if (!v || /[.\s]/.test(v)) {
      throw new Error('view token fields must be non-empty and contain no dots or whitespace');
    }
  }
  const body = `${VERSION}.${payload.orgId}.${payload.subjectType}.${payload.subjectId}.${issuedAt}`;
  const sig = signHmac(body, secret);
  return `${body}.${sig}`;
}

export function verifyViewToken(token: string, pepper?: string): ViewTokenPayload {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new ViewTokenError('server pepper not configured');
  const parts = token.split('.');
  if (parts.length !== 6) throw new ViewTokenError('malformed token');
  const [version, orgId, subjectType, subjectId, issuedAtStr, sig] = parts;
  if (version !== VERSION) throw new ViewTokenError(`unknown version ${version}`);
  const body = `${version}.${orgId}.${subjectType}.${subjectId}.${issuedAtStr}`;
  const expected = signHmac(body, secret);
  if (!timingSafeEqual(expected, sig!)) throw new ViewTokenError('signature mismatch');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) throw new ViewTokenError('issuedAt not numeric');
  return { orgId: orgId!, subjectType: subjectType!, subjectId: subjectId!, issuedAt };
}
