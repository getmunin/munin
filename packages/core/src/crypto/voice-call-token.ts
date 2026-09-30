import { signHmac, timingSafeEqual } from './primitives.ts';

const VERSION = 'vct1';
const NO_END_USER = '-';

export const VOICE_CALL_TOKEN_MAX_AGE_SECONDS = 12 * 60 * 60;
const FUTURE_SKEW_SECONDS = 5 * 60;

export interface VoiceCallTokenPayload {
  orgId: string;
  channelId: string;
  conversationId: string;
  endUserId: string | null;
  issuedAt: number;
}

export class VoiceCallTokenError extends Error {
  readonly code = 'voice_call_token_invalid';
  constructor(message: string) {
    super(`voice_call_token_invalid: ${message}`);
  }
}

export function signVoiceCallToken(
  payload: Omit<VoiceCallTokenPayload, 'issuedAt'> & { issuedAt?: number },
  pepper?: string,
): string {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new Error('MUNIN_KEY_PEPPER is required to sign voice call tokens');
  const issuedAt = payload.issuedAt ?? Math.floor(Date.now() / 1000);
  const endUser = payload.endUserId ?? NO_END_USER;
  for (const v of [payload.orgId, payload.channelId, payload.conversationId, endUser]) {
    if (!v || /[.\s]/.test(v)) {
      throw new Error('voice call token fields must be non-empty and contain no dots or whitespace');
    }
  }
  const body = `${VERSION}.${payload.orgId}.${payload.channelId}.${payload.conversationId}.${endUser}.${issuedAt}`;
  const sig = signHmac(body, secret);
  return `${body}.${sig}`;
}

export function verifyVoiceCallToken(
  token: string,
  pepper?: string,
  maxAgeSeconds: number = VOICE_CALL_TOKEN_MAX_AGE_SECONDS,
): VoiceCallTokenPayload {
  const secret = pepper ?? process.env.MUNIN_KEY_PEPPER ?? '';
  if (!secret) throw new VoiceCallTokenError('server pepper not configured');
  const parts = token.split('.');
  if (parts.length !== 7) throw new VoiceCallTokenError('malformed token');
  const [version, orgId, channelId, conversationId, endUser, issuedAtStr, sig] = parts;
  if (version !== VERSION) throw new VoiceCallTokenError(`unknown version ${version}`);
  const body = `${version}.${orgId}.${channelId}.${conversationId}.${endUser}.${issuedAtStr}`;
  const expected = signHmac(body, secret);
  if (!timingSafeEqual(expected, sig!)) throw new VoiceCallTokenError('signature mismatch');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) throw new VoiceCallTokenError('issuedAt not numeric');
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + FUTURE_SKEW_SECONDS) throw new VoiceCallTokenError('issuedAt in the future');
  if (now - issuedAt > maxAgeSeconds) throw new VoiceCallTokenError('token expired');
  return {
    orgId: orgId!,
    channelId: channelId!,
    conversationId: conversationId!,
    endUserId: endUser === NO_END_USER ? null : endUser!,
    issuedAt,
  };
}
