import { Injectable, Logger } from '@nestjs/common';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import { describeError } from '@getmunin/core';
import {
  BOT_FRAMEWORK_ISSUER,
  BOT_FRAMEWORK_OPENID_URL,
  TEAMS_CHANNEL_ID,
  normalizeServiceUrl,
} from './teams.constants.ts';

const CLOCK_TOLERANCE_SECONDS = 300;
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const FORCED_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const FAILED_REFRESH_BACKOFF_MS = 60_000;

export interface BotFrameworkKey {
  jwk: JWK;
  endorsements: string[];
}

export interface BotFrameworkKeyResolver {
  resolve(kid: string): Promise<BotFrameworkKey | null>;
}

export type TokenVerification =
  | { ok: true; appId: string }
  | { ok: false; reason: string };

export async function verifyBotFrameworkToken(input: {
  authorization: unknown;
  activityServiceUrl: unknown;
  isKnownAppId: (appId: string) => Promise<boolean>;
  keys: BotFrameworkKeyResolver;
  nowMs?: number;
}): Promise<TokenVerification> {
  if (typeof input.authorization !== 'string') return { ok: false, reason: 'missing_token' };
  const match = /^Bearer\s+(\S+)$/i.exec(input.authorization);
  if (!match) return { ok: false, reason: 'missing_token' };
  const token = match[1]!;

  let kid: string | undefined;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'RS256') return { ok: false, reason: 'unsupported_alg' };
    kid = header.kid;
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  if (!kid) return { ok: false, reason: 'missing_kid' };

  const key = await input.keys.resolve(kid);
  if (!key) return { ok: false, reason: 'unknown_key' };
  if (key.endorsements.length > 0 && !key.endorsements.includes(TEAMS_CHANNEL_ID)) {
    return { ok: false, reason: 'key_not_endorsed' };
  }

  let payload: Record<string, unknown>;
  try {
    const publicKey = await importJWK({ ...key.jwk, alg: 'RS256' }, 'RS256');
    const verified = await jwtVerify(token, publicKey, {
      issuer: BOT_FRAMEWORK_ISSUER,
      algorithms: ['RS256'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      ...(input.nowMs !== undefined ? { currentDate: new Date(input.nowMs) } : {}),
    });
    payload = verified.payload;
  } catch {
    return { ok: false, reason: 'invalid_signature_or_claims' };
  }

  const aud = typeof payload.aud === 'string' ? payload.aud : null;
  if (!aud || !(await input.isKnownAppId(aud))) return { ok: false, reason: 'unknown_audience' };

  const claimed = typeof payload.serviceurl === 'string' ? payload.serviceurl : null;
  if (
    !claimed ||
    typeof input.activityServiceUrl !== 'string' ||
    normalizeServiceUrl(claimed) !== normalizeServiceUrl(input.activityServiceUrl)
  ) {
    return { ok: false, reason: 'service_url_mismatch' };
  }
  return { ok: true, appId: aud };
}

@Injectable()
export class BotFrameworkKeyStore implements BotFrameworkKeyResolver {
  private readonly logger = new Logger(BotFrameworkKeyStore.name);
  private keys = new Map<string, BotFrameworkKey>();
  private fetchedAt = 0;
  private lastForcedRefresh = 0;
  private inflight: Promise<void> | null = null;

  async resolve(kid: string): Promise<BotFrameworkKey | null> {
    const now = Date.now();
    if (now - this.fetchedAt > KEY_TTL_MS) await this.refresh();
    const cached = this.keys.get(kid);
    if (cached) return cached;
    if (now - this.lastForcedRefresh < FORCED_REFRESH_INTERVAL_MS) return null;
    this.lastForcedRefresh = now;
    await this.refresh();
    return this.keys.get(kid) ?? null;
  }

  private async refresh(): Promise<void> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  private async load(): Promise<void> {
    try {
      const config = await fetchJson(BOT_FRAMEWORK_OPENID_URL);
      const jwksUri = typeof config.jwks_uri === 'string' ? config.jwks_uri : null;
      if (!jwksUri || !jwksUri.startsWith('https://login.botframework.com/')) {
        throw new Error('openid configuration has no botframework jwks_uri');
      }
      const jwks = await fetchJson(jwksUri);
      const next = new Map<string, BotFrameworkKey>();
      for (const raw of Array.isArray(jwks.keys) ? jwks.keys : []) {
        if (typeof raw !== 'object' || raw === null) continue;
        const entry = raw as Record<string, unknown>;
        if (typeof entry.kid !== 'string' || entry.kty !== 'RSA') continue;
        const endorsements = Array.isArray(entry.endorsements)
          ? entry.endorsements.filter((e): e is string => typeof e === 'string')
          : [];
        next.set(entry.kid, {
          jwk: { kty: 'RSA', n: entry.n as string, e: entry.e as string },
          endorsements,
        });
      }
      if (next.size === 0) throw new Error('botframework jwks has no RSA keys');
      this.keys = next;
      this.fetchedAt = Date.now();
    } catch (err) {
      this.fetchedAt = Math.max(this.fetchedAt, Date.now() - KEY_TTL_MS + FAILED_REFRESH_BACKOFF_MS);
      this.logger.warn(`bot framework key refresh failed: ${describeError(err)}`);
    }
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null) throw new Error(`GET ${url} → not an object`);
  return body as Record<string, unknown>;
}
