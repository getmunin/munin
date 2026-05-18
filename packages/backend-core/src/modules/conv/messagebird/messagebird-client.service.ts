import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  decryptSecretSql,
  setEncryptionKeySql,
} from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.js';

export interface SendSmsRequest {
  accessKey: string;
  originator: string;
  recipient: string;
  body: string;
  reportUrl?: string;
}

export interface SendSmsResponse {
  id: string;
  status: string;
  href: string | null;
}

const MESSAGEBIRD_API_BASE = 'https://rest.messagebird.com';

@Injectable()
export class MessageBirdClientService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new Error('messagebird_decrypt_failed');
    return pt;
  }

  async loadSecret(ciphertext: string): Promise<string> {
    return this.db.transaction((tx) => this.decryptString(tx, ciphertext));
  }

  async verifyAccessKey(accessKey: string): Promise<
    { ok: true; balance: unknown } | { ok: false; error: string }
  > {
    try {
      const res = await fetch(`${MESSAGEBIRD_API_BASE}/balance`, {
        headers: { authorization: `AccessKey ${accessKey}` },
      });
      if (res.status === 401) return { ok: false, error: 'messagebird_access_key_unauthorized' };
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `messagebird_${res.status}: ${text.slice(0, 200)}` };
      }
      const json = (await res.json()) as Record<string, unknown>;
      return { ok: true, balance: json };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendSms(req: SendSmsRequest): Promise<SendSmsResponse> {
    const url = `${MESSAGEBIRD_API_BASE}/messages`;
    const body = new URLSearchParams();
    body.set('originator', req.originator);
    body.set('body', req.body);
    body.set('recipients', req.recipient);
    if (req.reportUrl) body.set('reportUrl', req.reportUrl);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `AccessKey ${req.accessKey}`,
      },
      body: body.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errors = Array.isArray(json.errors) ? json.errors : [];
      const first = errors[0] as { description?: string; code?: number } | undefined;
      const desc = first?.description ?? `messagebird_send_failed_${res.status}`;
      const code = first?.code ?? res.status;
      throw new Error(`messagebird_${code}: ${desc}`);
    }
    return {
      id: typeof json.id === 'string' ? json.id : '',
      status: extractRecipientStatus(json),
      href: typeof json.href === 'string' ? json.href : null,
    };
  }
}

export interface JwtVerifyOptions {
  signingKey: string;
  token: string;
  url: string;
  rawBody: Buffer;
  now?: Date;
  clockSkewSec?: number;
}

export type JwtVerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

export function verifyMessageBirdJwt(opts: JwtVerifyOptions): JwtVerifyResult {
  const parts = opts.token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'jwt_malformed' };
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string; typ?: string };
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'jwt_decode_failed' };
  }
  if (header.alg !== 'HS256') return { ok: false, error: 'jwt_alg_unsupported' };
  if (header.typ && header.typ !== 'JWT') return { ok: false, error: 'jwt_typ_unsupported' };

  const expected = createHmac('sha256', opts.signingKey)
    .update(`${headerB64}.${payloadB64}`, 'utf8')
    .digest();
  let provided: Buffer;
  try {
    provided = base64UrlDecode(signatureB64);
  } catch {
    return { ok: false, error: 'jwt_signature_decode_failed' };
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, error: 'jwt_signature_mismatch' };
  }

  const now = Math.floor((opts.now?.getTime() ?? Date.now()) / 1000);
  const skew = opts.clockSkewSec ?? 60;
  const nbf = numberClaim(payload.nbf);
  const exp = numberClaim(payload.exp);
  if (nbf !== null && now + skew < nbf) return { ok: false, error: 'jwt_not_yet_valid' };
  if (exp !== null && now - skew > exp) return { ok: false, error: 'jwt_expired' };

  const urlHash = createHash('sha256').update(opts.url, 'utf8').digest('hex');
  if (typeof payload.url_hash !== 'string' || payload.url_hash !== urlHash) {
    return { ok: false, error: 'jwt_url_hash_mismatch' };
  }

  const expectedPayloadHash = createHash('sha256').update(opts.rawBody).digest('hex');
  const claimedPayloadHash = payload.payload_hash;
  if (opts.rawBody.length === 0) {
    if (claimedPayloadHash !== null && claimedPayloadHash !== undefined) {
      return { ok: false, error: 'jwt_payload_hash_present_for_empty_body' };
    }
  } else {
    if (typeof claimedPayloadHash !== 'string' || claimedPayloadHash !== expectedPayloadHash) {
      return { ok: false, error: 'jwt_payload_hash_mismatch' };
    }
  }

  return { ok: true, payload };
}

export function parseUrlEncoded(rawBody: Buffer): Record<string, string> {
  const text = rawBody.toString('utf8');
  const out: Record<string, string> = {};
  if (!text) return out;
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

export function reconstructWebhookUrl(opts: {
  headers: Record<string, string | string[] | undefined>;
  pathWithQuery: string;
  fallbackBase?: string;
}): string {
  const headerOne = (key: string): string | undefined => {
    const v = opts.headers[key.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const proto = headerOne('x-forwarded-proto') ?? 'https';
  const host = headerOne('x-forwarded-host') ?? headerOne('host');
  if (host) return `${proto}://${host}${opts.pathWithQuery}`;
  if (opts.fallbackBase) return `${opts.fallbackBase.replace(/\/$/, '')}${opts.pathWithQuery}`;
  return opts.pathWithQuery;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function numberClaim(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function extractRecipientStatus(json: Record<string, unknown>): string {
  const recipients = json.recipients as
    | { items?: Array<{ status?: string }> }
    | undefined;
  return recipients?.items?.[0]?.status ?? 'sent';
}
