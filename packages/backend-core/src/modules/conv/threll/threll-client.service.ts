import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { decryptSecretSql, setEncryptionKeySql } from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';

const THRELL_API_BASE = 'https://api.threll.io/v1';

export interface PlaceCallRequest {
  apiKey: string;
  accountId: string;
  workerId: string;
  toNumber: string;
  context?: string;
  customer?: { firstName?: string; lastName?: string; externalId?: string };
}

export interface PlaceCallResponse {
  id: string;
  status: string;
}

export interface ThrellWorkerSummary {
  id: string;
  name: string | null;
}

export interface ThrellExternalTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  deliveryUrl: string;
  signingSecret?: string;
}

export interface CreateWebCallRequest {
  apiKey: string;
  accountId: string;
  workerId: string;
  instructions?: string;
  context?: string;
  externalTools?: ThrellExternalTool[];
  allowedOrigins?: string[];
  customer?: { firstName?: string; lastName?: string; externalId?: string };
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CreateWebCallResponse {
  callId: string;
  sessionId: string;
  signalingUrl: string;
  token: string;
  iceServers: IceServer[];
  expiresAt: string;
}

@Injectable()
export class ThrellClientService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new Error('threll_decrypt_failed');
    return pt;
  }

  async loadSecret(ciphertext: string): Promise<string> {
    return this.db.transaction((tx) => this.decryptString(tx, ciphertext));
  }

  async fetchWorker(opts: {
    apiKey: string;
    accountId: string;
    workerId: string;
  }): Promise<
    { ok: true; worker: ThrellWorkerSummary } | { ok: false; error: string }
  > {
    try {
      const res = await fetch(
        `${THRELL_API_BASE}/accounts/${encodeURIComponent(opts.accountId)}/workers/${encodeURIComponent(opts.workerId)}`,
        { headers: { 'x-api-key': opts.apiKey } },
      );
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'threll_unauthorized' };
      if (res.status === 404) return { ok: false, error: 'threll_worker_not_found' };
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `threll_${res.status}: ${text.slice(0, 200)}` };
      }
      const json = (await res.json()) as Record<string, unknown>;
      return {
        ok: true,
        worker: {
          id: typeof json.id === 'string' ? json.id : opts.workerId,
          name: typeof json.name === 'string' ? json.name : null,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResponse> {
    const body: Record<string, unknown> = {
      workerId: req.workerId,
      phoneNumber: req.toNumber,
    };
    if (req.context) body.context = req.context;
    if (req.customer) body.customer = req.customer;
    const res = await fetch(
      `${THRELL_API_BASE}/accounts/${encodeURIComponent(req.accountId)}/phone-calls`,
      {
        method: 'POST',
        headers: { 'x-api-key': req.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message =
        (typeof json.message === 'string' && json.message) ||
        `threll_place_call_failed_${res.status}`;
      throw new Error(`threll_${res.status}: ${message}`);
    }
    return {
      id: typeof json.id === 'string' ? json.id : '',
      status: typeof json.status === 'string' ? json.status : '',
    };
  }

  async createWebCall(
    req: CreateWebCallRequest,
  ): Promise<{ ok: true; webCall: CreateWebCallResponse } | { ok: false; error: string }> {
    const body: Record<string, unknown> = { workerId: req.workerId };
    if (req.instructions) body.instructions = req.instructions;
    if (req.context) body.context = req.context;
    if (req.externalTools && req.externalTools.length > 0) body.externalTools = req.externalTools;
    if (req.allowedOrigins && req.allowedOrigins.length > 0) body.allowedOrigins = req.allowedOrigins;
    if (req.customer) body.customer = req.customer;
    try {
      const res = await fetch(
        `${THRELL_API_BASE}/accounts/${encodeURIComponent(req.accountId)}/web-calls`,
        {
          method: 'POST',
          headers: { 'x-api-key': req.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const message =
          (typeof json.message === 'string' && json.message) || `threll_web_call_failed_${res.status}`;
        return { ok: false, error: `threll_${res.status}: ${message}` };
      }
      return {
        ok: true,
        webCall: {
          callId: typeof json.callId === 'string' ? json.callId : '',
          sessionId: typeof json.sessionId === 'string' ? json.sessionId : '',
          signalingUrl: typeof json.signalingUrl === 'string' ? json.signalingUrl : '',
          token: typeof json.token === 'string' ? json.token : '',
          iceServers: Array.isArray(json.iceServers) ? (json.iceServers as IceServer[]) : [],
          expiresAt: typeof json.expiresAt === 'string' ? json.expiresAt : '',
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const THRELL_SIGNATURE_HEADER = 'x-threll-signature';

export function verifyThrellSignature(opts: {
  secret: string;
  rawBody: Buffer;
  signature: string;
}): boolean {
  if (!opts.signature) return false;
  const expected = createHmac('sha256', opts.secret).update(opts.rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(opts.signature.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
