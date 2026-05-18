import { Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  decryptSecretSql,
  setEncryptionKeySql,
} from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.js';

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
        id: String(json.id ?? opts.assistantId),
        name: typeof json.name === 'string' ? json.name : null,
      },
    };
  }

  async fetchAssistantConfig(opts: {
    apiKey: string;
    assistantId: string;
  }): Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${VAPI_API_BASE}/assistant/${encodeURIComponent(opts.assistantId)}`, {
        headers: { authorization: `Bearer ${opts.apiKey}` },
      });
      if (res.status === 401) return { ok: false, error: 'vapi_unauthorized' };
      if (res.status === 404) return { ok: false, error: 'vapi_assistant_not_found' };
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `vapi_${res.status}: ${text.slice(0, 200)}` };
      }
      const json = (await res.json()) as Record<string, unknown>;
      return { ok: true, config: json };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResponse> {
    const body: Record<string, unknown> = {
      assistantId: req.assistantId,
      phoneNumberId: req.phoneNumberId,
      customer: { number: req.toNumber, ...(req.customer ?? {}) },
    };
    if (req.assistantOverrides) body.assistantOverrides = req.assistantOverrides;
    const res = await fetch(`${VAPI_API_BASE}/call`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${req.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message =
        (typeof json.message === 'string' && json.message) ||
        (Array.isArray(json.message) && (json.message as string[]).join('; ')) ||
        `vapi_place_call_failed_${res.status}`;
      throw new Error(`vapi_${res.status}: ${message}`);
    }
    return {
      id: String(json.id ?? ''),
      status: String(json.status ?? ''),
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
