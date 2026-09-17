import { signHmac, verifyHmac } from '@getmunin/core';

const MAX_STATE_CHARS = 4096;

export function signSignedState(payload: object, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signHmac(encoded, secret)}`;
}

export function readSignedState(raw: unknown, secret: string): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_STATE_CHARS) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = raw.slice(0, dot);
  if (!verifyHmac(encoded, secret, raw.slice(dot + 1))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const state = parsed as Record<string, unknown>;
  const exp = state['exp'];
  if (typeof exp !== 'number' || exp < Date.now()) return null;
  return state;
}
