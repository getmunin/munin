import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  decryptSecretSql,
  setEncryptionKeySql,
} from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.js';

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export interface SendSmsRequest {
  accountSid: string;
  authToken: string;
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
  statusCallback?: string;
}

export interface SendSmsResponse {
  sid: string;
  status: string;
  errorCode?: number | null;
  errorMessage?: string | null;
}

const TWILIO_API_BASE = 'https://api.twilio.com';

@Injectable()
export class TwilioClientService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async decryptAuthToken(tx: Db | Tx, ciphertext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new Error('twilio_auth_token_decrypt_failed');
    return pt;
  }

  async loadAuthToken(ciphertext: string): Promise<string> {
    return this.db.transaction((tx) => this.decryptAuthToken(tx, ciphertext));
  }

  async verifyCredentials(req: { accountSid: string; authToken: string }): Promise<
    { ok: true; friendlyName: string; status: string } | { ok: false; error: string }
  > {
    const url = `${TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(req.accountSid)}.json`;
    const auth = Buffer.from(`${req.accountSid}:${req.authToken}`).toString('base64');
    try {
      const res = await fetch(url, { headers: { authorization: `Basic ${auth}` } });
      if (res.status === 401) return { ok: false, error: 'twilio_credentials_unauthorized' };
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `twilio_${res.status}: ${text.slice(0, 200)}` };
      }
      const json = (await res.json()) as Record<string, unknown>;
      return {
        ok: true,
        friendlyName: String(json.friendly_name ?? ''),
        status: String(json.status ?? ''),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendSms(req: SendSmsRequest): Promise<SendSmsResponse> {
    if (!req.from && !req.messagingServiceSid) {
      throw new Error('twilio_send_requires_from_or_messaging_service_sid');
    }
    const url = `${TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(req.accountSid)}/Messages.json`;
    const body = new URLSearchParams();
    body.set('To', req.to);
    body.set('Body', req.body);
    if (req.from) body.set('From', req.from);
    if (req.messagingServiceSid) body.set('MessagingServiceSid', req.messagingServiceSid);
    if (req.statusCallback) body.set('StatusCallback', req.statusCallback);

    const auth = Buffer.from(`${req.accountSid}:${req.authToken}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${auth}`,
      },
      body: body.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message = typeof json.message === 'string' ? json.message : `twilio_send_failed_${res.status}`;
      const code = typeof json.code === 'number' ? json.code : res.status;
      throw new Error(`twilio_${code}: ${message}`);
    }
    return {
      sid: String(json.sid ?? ''),
      status: String(json.status ?? ''),
      errorCode: typeof json.error_code === 'number' ? json.error_code : null,
      errorMessage: typeof json.error_message === 'string' ? json.error_message : null,
    };
  }
}

export function validateTwilioSignature(opts: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string;
}): boolean {
  if (!opts.signature) return false;
  const keys = Object.keys(opts.params).sort();
  let data = opts.url;
  for (const k of keys) data += k + opts.params[k];
  const expected = createHmac('sha1', opts.authToken).update(data, 'utf8').digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(opts.signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
