import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { decryptSecretSql, readApiBaseUrl, setEncryptionKeySql } from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import { asRecord, toRows } from '../channels/json-shape.ts';

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
  inboundPhoneNumber?: string | null;
  outboundPhoneNumber?: string | null;
}

export interface ThrellAccountSummary {
  id: string;
  name: string | null;
}

export interface ThrellWebhookSubscriptionSummary {
  id: string;
  url: string;
  eventType: string | null;
  enabled: boolean;
  signingSecret: string | null;
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
  metadata?: Record<string, unknown>;
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

  private async request(opts: {
    apiKey: string;
    path: string;
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
    notFoundError?: string;
  }): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${THRELL_API_BASE}${opts.path}`, {
        method: opts.method ?? 'GET',
        headers: {
          'x-api-key': opts.apiKey,
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
      const status: HttpStatus = res.status;
      if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
        return { ok: false, error: 'threll_unauthorized' };
      }
      if (status === HttpStatus.NOT_FOUND && opts.notFoundError) {
        return { ok: false, error: opts.notFoundError };
      }
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = asRecord(json).message;
        return {
          ok: false,
          error: `threll_${res.status}: ${typeof message === 'string' ? message : res.status}`,
        };
      }
      return { ok: true, json };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetchWorker(opts: {
    apiKey: string;
    accountId: string;
    workerId: string;
  }): Promise<{ ok: true; worker: ThrellWorkerSummary } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/accounts/${encodeURIComponent(opts.accountId)}/workers/${encodeURIComponent(opts.workerId)}`,
      notFoundError: 'threll_worker_not_found',
    });
    if (!r.ok) return r;
    const worker = toWorker(r.json);
    return { ok: true, worker: { ...worker, id: worker.id || opts.workerId } };
  }

  async fetchAccount(opts: {
    apiKey: string;
    accountId: string;
  }): Promise<{ ok: true; account: ThrellAccountSummary } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/accounts/${encodeURIComponent(opts.accountId)}`,
      notFoundError: 'threll_account_not_found',
    });
    if (!r.ok) return r;
    const json = asRecord(r.json);
    return {
      ok: true,
      account: {
        id: typeof json.id === 'string' ? json.id : opts.accountId,
        name: typeof json.name === 'string' ? json.name : null,
      },
    };
  }

  async fetchCurrentAccount(opts: {
    apiKey: string;
  }): Promise<{ ok: true; account: ThrellAccountSummary } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/accounts/current`,
      notFoundError: 'threll_account_not_found',
    });
    if (!r.ok) return r;
    const json = asRecord(r.json);
    return {
      ok: true,
      account: {
        id: typeof json.id === 'string' ? json.id : '',
        name: typeof json.name === 'string' ? json.name : null,
      },
    };
  }

  async listWorkers(opts: {
    apiKey: string;
    accountId: string;
  }): Promise<{ ok: true; workers: ThrellWorkerSummary[] } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/accounts/${encodeURIComponent(opts.accountId)}/workers`,
      notFoundError: 'threll_account_not_found',
    });
    if (!r.ok) return r;
    const workers = toRows(r.json, 'workers')
      .map(toWorker)
      .filter((w) => w.id.length > 0);
    return { ok: true, workers };
  }

  async listWebhookSubscriptions(opts: {
    apiKey: string;
    accountId: string;
  }): Promise<
    { ok: true; subscriptions: ThrellWebhookSubscriptionSummary[] } | { ok: false; error: string }
  > {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/accounts/${encodeURIComponent(opts.accountId)}/webhook-subscriptions`,
      notFoundError: 'threll_account_not_found',
    });
    if (!r.ok) return r;
    const subscriptions = toRows(r.json, 'subscriptions', 'webhookSubscriptions').map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      url: typeof row.url === 'string' ? row.url : '',
      eventType: typeof row.eventType === 'string' ? row.eventType : null,
      enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
      signingSecret:
        typeof row.signingSecret === 'string'
          ? row.signingSecret
          : typeof row.signing_secret === 'string'
            ? row.signing_secret
            : null,
    }));
    return { ok: true, subscriptions };
  }

  async deleteWebhookSubscription(opts: {
    apiKey: string;
    accountId: string;
    subscriptionId: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/accounts/${encodeURIComponent(opts.accountId)}/webhook-subscriptions/${encodeURIComponent(opts.subscriptionId)}`,
      method: 'DELETE',
      notFoundError: 'threll_webhook_subscription_not_found',
    });
    return r.ok ? { ok: true } : r;
  }

  async createWebhookSubscription(opts: {
    apiKey: string;
    accountId: string;
    url: string;
  }): Promise<{ ok: true; signingSecret: string } | { ok: false; error: string }> {
    const r = await this.request({
      apiKey: opts.apiKey,
      path: `/accounts/${encodeURIComponent(opts.accountId)}/webhook-subscriptions`,
      method: 'POST',
      body: { eventType: '*', url: opts.url, required: true },
      notFoundError: 'threll_account_not_found',
    });
    if (!r.ok) return r;
    const signingSecret = readSigningSecret(asRecord(r.json));
    if (!signingSecret) return { ok: false, error: 'threll_missing_signing_secret' };
    return { ok: true, signingSecret };
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResponse> {
    const body: Record<string, unknown> = { workerId: req.workerId, phoneNumber: req.toNumber };
    if (req.context) body.context = req.context;
    if (req.customer) body.customer = req.customer;
    const r = await this.request({
      apiKey: req.apiKey,
      path: `/accounts/${encodeURIComponent(req.accountId)}/phone-calls`,
      method: 'POST',
      body,
    });
    if (!r.ok) throw new Error(r.error);
    const json = asRecord(r.json);
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
    if (req.metadata && Object.keys(req.metadata).length > 0) body.metadata = req.metadata;
    if (req.customer) body.customer = req.customer;
    const r = await this.request({
      apiKey: req.apiKey,
      path: `/accounts/${encodeURIComponent(req.accountId)}/web-calls`,
      method: 'POST',
      body,
    });
    if (!r.ok) return r;
    const json = asRecord(r.json);
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
  }
}

function toWorker(json: unknown): ThrellWorkerSummary {
  const r = asRecord(json);
  return {
    id: typeof r.id === 'string' ? r.id : '',
    name: typeof r.name === 'string' ? r.name : null,
    inboundPhoneNumber: typeof r.inboundPhoneNumber === 'string' ? r.inboundPhoneNumber : null,
    outboundPhoneNumber: typeof r.outboundPhoneNumber === 'string' ? r.outboundPhoneNumber : null,
  };
}

function readSigningSecret(json: Record<string, unknown>): string | undefined {
  const nested = (json.subscription ?? json.webhookSubscription) as
    | Record<string, unknown>
    | undefined;
  const candidates = [
    json.signingSecret,
    json.signing_secret,
    nested?.signingSecret,
    nested?.signing_secret,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return undefined;
}

export function buildWebhookUrl(channelId: string): string {
  return `${readApiBaseUrl()}/v1/conversations/channels/${channelId}/webhook`;
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
