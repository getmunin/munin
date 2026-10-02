import { Inject, Injectable } from '@nestjs/common';
import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { decryptSecretSql, readApiBaseUrl, setEncryptionKeySql } from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import type { StrexEnvironment } from '@getmunin/types';
import { DB } from '../../../common/db/db.module.ts';

export const STREX_BASE_URLS: Record<StrexEnvironment, string> = {
  production: 'https://shared.target365.io',
  test: 'https://test.target365.io',
};

export const STREX_SIGNATURE_HEADER = 'x-ecdsa-signature';

const SIGNATURE_MAX_SKEW_SEC = 5 * 60;

export interface StrexCredentials {
  apiKey: string;
  environment: StrexEnvironment;
}

export interface StrexOutMessage {
  transactionId: string;
  sender: string;
  recipient: string;
  content: string;
  deliveryReportUrl?: string;
}

export type StrexKeywordMode = 'Startswith' | 'Exact' | 'Wildcard' | 'Regex';

export interface StrexKeyword {
  keywordId: string;
  shortNumberId: string;
  keywordText: string;
  mode: string;
  forwardUrl: string;
  enabled: boolean;
}

export interface StrexKeywordInput {
  shortNumberId: string;
  keywordText: string;
  mode: StrexKeywordMode;
  forwardUrl: string;
}

export interface StrexPublicKey {
  name: string;
  publicKeyString: string;
  signAlgo: string;
}

@Injectable()
export class StrexClientService {
  private readonly serverKeys = new Map<string, KeyObject>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new Error('strex_decrypt_failed');
    return pt;
  }

  async loadSecret(ciphertext: string): Promise<string> {
    return this.db.transaction((tx) => this.decryptString(tx, ciphertext));
  }

  async verifyApiKey(creds: StrexCredentials): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await this.request(creds, 'GET', '/api/client/public-keys');
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'strex_api_key_unauthorized' };
      }
      if (!res.ok) return { ok: false, error: await describeFailure(res) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendSms(creds: StrexCredentials, message: StrexOutMessage): Promise<{ transactionId: string }> {
    const res = await this.request(creds, 'POST', '/api/out-messages', {
      transactionId: message.transactionId,
      sender: message.sender,
      recipient: message.recipient,
      content: message.content,
      ...(message.deliveryReportUrl ? { deliveryReportUrl: message.deliveryReportUrl } : {}),
    });
    if (!res.ok) throw new Error(await describeFailure(res));
    return { transactionId: message.transactionId };
  }

  async listKeywords(
    creds: StrexCredentials,
    filter: { shortNumberId: string; keywordText?: string },
  ): Promise<StrexKeyword[]> {
    const params = new URLSearchParams({ shortNumberId: filter.shortNumberId });
    if (filter.keywordText) params.set('keywordText', filter.keywordText);
    const res = await this.request(creds, 'GET', `/api/keywords?${params.toString()}`);
    if (!res.ok) throw new Error(await describeFailure(res));
    const json: unknown = await res.json().catch(() => []);
    return Array.isArray(json) ? json.map(toKeyword).filter((k): k is StrexKeyword => k !== null) : [];
  }

  async getKeyword(creds: StrexCredentials, keywordId: string): Promise<StrexKeyword | null> {
    const res = await this.request(creds, 'GET', `/api/keywords/${encodeURIComponent(keywordId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await describeFailure(res));
    return toKeyword(await res.json().catch(() => null));
  }

  async createKeyword(creds: StrexCredentials, input: StrexKeywordInput): Promise<string> {
    const res = await this.request(creds, 'POST', '/api/keywords', { ...input, enabled: true });
    if (!res.ok) throw new Error(await describeFailure(res));
    const keywordId = keywordIdFromLocation(res.headers.get('location'));
    if (!keywordId) throw new Error('strex_keyword_create_missing_location');
    return keywordId;
  }

  async deleteKeyword(creds: StrexCredentials, keywordId: string): Promise<void> {
    const res = await this.request(creds, 'DELETE', `/api/keywords/${encodeURIComponent(keywordId)}`);
    if (res.status === 404) return;
    if (!res.ok) throw new Error(await describeFailure(res));
  }

  async serverPublicKey(creds: StrexCredentials, keyName: string): Promise<KeyObject> {
    const cacheKey = `${creds.environment}:${keyName}`;
    const cached = this.serverKeys.get(cacheKey);
    if (cached) return cached;
    const res = await this.request(
      creds,
      'GET',
      `/api/server/public-keys/${encodeURIComponent(keyName)}`,
    );
    if (res.status === 404) throw new Error('strex_server_key_not_found');
    if (!res.ok) throw new Error(await describeFailure(res));
    const json = (await res.json()) as Partial<StrexPublicKey>;
    if (typeof json.publicKeyString !== 'string' || !json.publicKeyString) {
      throw new Error('strex_server_key_malformed');
    }
    if (json.signAlgo && json.signAlgo !== 'ECDsaP256') {
      throw new Error(`strex_server_key_unsupported_algo: ${json.signAlgo}`);
    }
    const key = parseStrexPublicKey(json.publicKeyString);
    this.serverKeys.set(cacheKey, key);
    return key;
  }

  private request(
    creds: StrexCredentials,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${STREX_BASE_URLS[creds.environment]}${path}`, {
      method,
      headers: {
        'x-apikey': creds.apiKey,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}

export function buildStrexWebhookUrl(channelId: string): string {
  return `${readApiBaseUrl()}/v1/conversations/channels/${channelId}/webhook`;
}

export interface ParsedStrexSignature {
  keyName: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export function parseStrexSignatureHeader(header: string): ParsedStrexSignature | null {
  const parts = header.trim().split(':');
  if (parts.length !== 4) return null;
  const [keyName, ts, nonce, signature] = parts as [string, string, string, string];
  if (!keyName || !nonce || !signature || !/^\d+$/.test(ts)) return null;
  return { keyName, timestamp: Number(ts), nonce, signature };
}

export function strexSigningMessage(opts: {
  method: string;
  uri: string;
  timestamp: number;
  nonce: string;
  rawBody: Buffer;
}): string {
  const contentHash =
    opts.rawBody.length > 0 ? createHash('sha256').update(opts.rawBody).digest('base64') : '';
  return `${opts.method.toLowerCase()}${opts.uri.toLowerCase()}${opts.timestamp}${opts.nonce}${contentHash}`;
}

export function verifyStrexSignature(opts: {
  publicKey: KeyObject;
  signature: ParsedStrexSignature;
  method: string;
  uri: string;
  rawBody: Buffer;
  now?: Date;
}): { ok: true } | { ok: false; error: string } {
  const now = Math.floor((opts.now?.getTime() ?? Date.now()) / 1000);
  if (Math.abs(now - opts.signature.timestamp) > SIGNATURE_MAX_SKEW_SEC) {
    return { ok: false, error: 'signature_clock_skew' };
  }
  const message = strexSigningMessage({
    method: opts.method,
    uri: opts.uri,
    timestamp: opts.signature.timestamp,
    nonce: opts.signature.nonce,
    rawBody: opts.rawBody,
  });
  const sig = Buffer.from(opts.signature.signature, 'base64');
  if (sig.length !== 64) return { ok: false, error: 'signature_length_invalid' };
  const valid = verifySignature(
    'sha256',
    Buffer.from(message, 'utf8'),
    { key: opts.publicKey, dsaEncoding: 'ieee-p1363' },
    sig,
  );
  return valid ? { ok: true } : { ok: false, error: 'signature_mismatch' };
}

export function parseStrexPublicKey(publicKeyString: string): KeyObject {
  const trimmed = publicKeyString.trim();
  if (trimmed.startsWith('-----BEGIN')) return createPublicKey(trimmed);
  return createPublicKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'spki' });
}

export type StrexDeliveryState = 'sent' | 'failed';

export function mapStrexDeliveryReport(report: {
  statusCode?: unknown;
  detailedStatusCode?: unknown;
}): { status: StrexDeliveryState; error: string | null } | null {
  const statusCode = typeof report.statusCode === 'string' ? report.statusCode : '';
  const detailed = typeof report.detailedStatusCode === 'string' ? report.detailedStatusCode : '';
  if (detailed === 'DuplicateTransaction') return null;
  switch (statusCode) {
    case 'Sent':
    case 'Ok':
      return { status: 'sent', error: null };
    case 'Failed':
      return { status: 'failed', error: `strex_${detailed || 'Failed'}` };
    default:
      return null;
  }
}

function keywordIdFromLocation(location: string | null): string | null {
  if (!location) return null;
  const segment = location.replace(/\/+$/, '').split('/').pop();
  return segment ? decodeURIComponent(segment) : null;
}

function toKeyword(raw: unknown): StrexKeyword | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.keywordId !== 'string') return null;
  return {
    keywordId: r.keywordId,
    shortNumberId: typeof r.shortNumberId === 'string' ? r.shortNumberId : '',
    keywordText: typeof r.keywordText === 'string' ? r.keywordText : '',
    mode: typeof r.mode === 'string' ? r.mode : '',
    forwardUrl: typeof r.forwardUrl === 'string' ? r.forwardUrl : '',
    enabled: r.enabled === true,
  };
}

async function describeFailure(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const message = json.message ?? json.Message ?? json.title;
    if (typeof message === 'string') detail = message;
  } catch {
    detail = text;
  }
  return `strex_${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
}
