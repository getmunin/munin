import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  decryptSecretSql,
  setEncryptionKeySql,
} from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import { asRecord, toRows } from '../channels/json-shape.ts';

const VAPI_API_BASE = 'https://api.vapi.ai';

export interface PlaceCallRequest {
  apiKey: string;
  assistantId: string;
  phoneNumberId: string;
  toNumber: string;
  customer?: { name?: string; email?: string };
  assistantOverrides?: Record<string, unknown>;
}

export interface PlaceCallResponse {
  id: string;
  status: string;
}

export interface VapiAssistantSummary {
  id: string;
  name: string | null;
}

@Injectable()
export class VapiClientService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new Error('vapi_decrypt_failed');
    return pt;
  }

  async loadSecret(ciphertext: string): Promise<string> {
    return this.db.transaction((tx) => this.decryptString(tx, ciphertext));
  }

  async fetchAssistant(opts: {
    apiKey: string;
    assistantId: string;
  }): Promise<{ ok: true; assistant: VapiAssistantSummary } | { ok: false; error: string }> {
    const res = await this.fetchAssistantConfig(opts);
    if (!res.ok) return res;
    const json = res.config;
    return {
      ok: true,
      assistant: {
        id: typeof json.id === 'string' ? json.id : opts.assistantId,
        name: typeof json.name === 'string' ? json.name : null,
      },
    };
  }

  private async request(opts: {
    apiKey: string;
    path: string;
    method?: 'GET' | 'POST' | 'PATCH';
    body?: Record<string, unknown>;
    notFoundError?: string;
  }): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${VAPI_API_BASE}${opts.path}`, {
        method: opts.method ?? 'GET',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
      const status: HttpStatus = res.status;
      if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
        return { ok: false, error: 'vapi_unauthorized' };
      }
      if (status === HttpStatus.NOT_FOUND && opts.notFoundError) {
        return { ok: false, error: opts.notFoundError };
      }
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = asRecord(json).message;
        const detail =
          typeof message === 'string'
            ? message
            : Array.isArray(message)
              ? message.filter((m): m is string => typeof m === 'string').join('; ')
              : String(res.status);
        return { ok: false, error: `vapi_${res.status}: ${detail}` };
      }
      return { ok: true, json };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetchAssistantConfig(opts: {
    apiKey: string;
    assistantId: string;
  }): Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/assistant/${encodeURIComponent(opts.assistantId)}`,
      notFoundError: 'vapi_assistant_not_found',
    });
    if (!r.ok) return r;
    return { ok: true, config: asRecord(r.json) };
  }

  async listAssistants(opts: {
    apiKey: string;
  }): Promise<{ ok: true; assistants: VapiAssistantSummary[] } | { ok: false; error: string }> {
    const r = await this.request({ apiKey: opts.apiKey, path: '/assistant' });
    if (!r.ok) return r;
    const assistants = toRows(r.json, 'results')
      .map((row) => ({
        id: typeof row.id === 'string' ? row.id : '',
        name: typeof row.name === 'string' ? row.name : null,
      }))
      .filter((a) => a.id.length > 0);
    return { ok: true, assistants };
  }

  async updateAssistantServer(opts: {
    apiKey: string;
    assistantId: string;
    server: Record<string, unknown> | null;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/assistant/${encodeURIComponent(opts.assistantId)}`,
      method: 'PATCH',
      body: { server: opts.server },
      notFoundError: 'vapi_assistant_not_found',
    });
    return r.ok ? { ok: true } : r;
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResponse> {
    const body: Record<string, unknown> = {
      assistantId: req.assistantId,
      phoneNumberId: req.phoneNumberId,
      customer: { number: req.toNumber, ...(req.customer ?? {}) },
    };
    if (req.assistantOverrides) body.assistantOverrides = req.assistantOverrides;
    const r = await this.request({ apiKey: req.apiKey, path: '/call', method: 'POST', body });
    if (!r.ok) throw new Error(r.error);
    const json = asRecord(r.json);
    return {
      id: typeof json.id === 'string' ? json.id : '',
      status: typeof json.status === 'string' ? json.status : '',
    };
  }
}

export const VAPI_WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

export function verifyVapiWebhookSecret(opts: {
  expected: string;
  provided: string;
}): boolean {
  if (!opts.provided) return false;
  const a = Buffer.from(opts.expected, 'utf8');
  const b = Buffer.from(opts.provided.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
