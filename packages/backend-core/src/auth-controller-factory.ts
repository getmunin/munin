import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import {
  type McpOrgScopeInput,
  orgScopedMcpResourceUrl,
  parseOrgScopedMcpResource,
  withOrgScopedMcpResource,
} from '@getmunin/core';
import { mcpResourceUrl } from './oauth/oauth.constants.ts';
import { orgScopeStore } from './auth/org-scope-store.ts';

interface BetterAuthLike {
  handler: (req: globalThis.Request) => Promise<globalThis.Response>;
}

interface BodyOverride {
  contentType: string;
  body: string;
}

export async function handleAuthRequest(
  auth: BetterAuthLike,
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> {
  await withOrgScopedMcpResource(await resolveMcpOrgScope(req), async () => {
    const fetchRequest = expressRequestToFetch(req, narrowOrgScopedResourceBody(req));
    const fetchResponse = await auth.handler(fetchRequest);
    await pipeFetchResponseToExpress(fetchResponse, res);
  });
}

export async function resolveMcpOrgScope(req: ExpressRequest): Promise<McpOrgScopeInput> {
  const requested = readRequestedResource(req);
  const orgFromResource = requested ? parseOrgScopedMcpResource(requested) : null;
  const store = orgScopeStore();
  const associationKey = store?.keyFor(req.headers?.['cookie'], readCodeChallenge(req)) ?? null;

  if (orgFromResource) return { resource: requested, associationKey };

  if (store && associationKey) {
    try {
      const orgId = await store.recall(associationKey);
      if (orgId) return { resource: orgScopedMcpResourceUrl(orgId), associationKey };
    } catch (err) {
      console.warn('[auth] could not recall the org this authorization was started for', { err });
    }
  }
  return { resource: null, associationKey };
}

export function readCodeChallenge(req: ExpressRequest): string | null {
  const fromQuery = firstString(req.query?.['code_challenge']);
  if (fromQuery) return fromQuery;
  const body = readObjectBody(req);
  const fromBody = firstString(body?.['code_challenge']);
  if (fromBody) return fromBody;
  const oauthQuery = firstString(body?.['oauth_query']);
  if (oauthQuery) return new URLSearchParams(oauthQuery).get('code_challenge');
  return null;
}


export function readRequestedResource(req: ExpressRequest): string | null {
  const fromQuery = firstString(req.query?.['resource']);
  if (fromQuery) return fromQuery;
  const body = readObjectBody(req);
  const fromBody = firstString(body?.['resource']);
  if (fromBody) return fromBody;
  const oauthQuery = firstString(body?.['oauth_query']);
  if (oauthQuery) {
    const fromOauthQuery = new URLSearchParams(oauthQuery).get('resource');
    if (fromOauthQuery) return fromOauthQuery;
  }
  return null;
}

export function narrowOrgScopedResourceBody(req: ExpressRequest): BodyOverride | null {
  const body = readObjectBody(req);
  const resource = firstString(body?.['resource']);
  if (!body || !resource || !parseOrgScopedMcpResource(resource)) return null;

  const contentType = req.headers['content-type']?.toString() ?? '';
  const rawBody = (req as ExpressRequest & { rawBody?: Buffer }).rawBody;
  if (contentType.includes('application/x-www-form-urlencoded') && rawBody?.length) {
    const params = new URLSearchParams(rawBody.toString('utf8'));
    params.set('resource', mcpResourceUrl());
    return { contentType: 'application/x-www-form-urlencoded', body: params.toString() };
  }
  return {
    contentType: 'application/json',
    body: JSON.stringify({ ...body, resource: mcpResourceUrl() }),
  };
}

function readObjectBody(req: ExpressRequest): Record<string, unknown> | null {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
  }
  return null;
}

export function requireAuthSecret(): string {
  const secret = process.env.MUNIN_AUTH_SECRET;
  if (!secret) throw new Error('MUNIN_AUTH_SECRET is required');
  assertProductionAuthSecret(secret);
  return secret;
}

export function assertProductionAuthSecret(secret: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (secret.length < 32) {
    throw new Error(
      'MUNIN_AUTH_SECRET must be at least 32 characters in production. Generate one with `openssl rand -base64 48`.',
    );
  }
  if (isPlaceholderSecret(secret)) {
    throw new Error(
      'MUNIN_AUTH_SECRET looks like a placeholder/dev value. Generate a real secret with `openssl rand -base64 48`.',
    );
  }
}

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^replace[-_]?me/i,
  /^dev[-_]?secret/i,
  /^test[-_]?secret/i,
  /^changeme/i,
  /do[-_]?not[-_]?use/i,
  /^(?:[a-z]+|x+|0+)$/i,
];

function isPlaceholderSecret(secret: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(secret));
}

function expressRequestToFetch(
  req: ExpressRequest,
  bodyOverride: BodyOverride | null = null,
): globalThis.Request {
  const protocol = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
  const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
  const url = `${protocol}://${host}${req.originalUrl}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (typeof value === 'string') headers.set(name, value);
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (bodyOverride) {
      headers.set('content-type', bodyOverride.contentType);
      headers.delete('content-length');
      init.body = bodyOverride.body;
      return new globalThis.Request(url, init);
    }
    const rawBody = (req as ExpressRequest & { rawBody?: Buffer }).rawBody;
    if (rawBody && rawBody.length > 0) {
      init.body = new Uint8Array(rawBody);
    } else {
      const body: unknown = req.body;
      if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        init.body = JSON.stringify(body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
    }
  }
  return new globalThis.Request(url, init);
}

async function pipeFetchResponseToExpress(
  fetchResponse: globalThis.Response,
  res: ExpressResponse,
): Promise<void> {
  res.status(fetchResponse.status);
  fetchResponse.headers.forEach((value: string, name: string) => {
    res.setHeader(name, value);
  });
  const body = await fetchResponse.text();
  res.send(body);
}
