import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import {
  type McpOrgScopeInput,
  orgScopedMcpResourceUrl,
  parseOrgScopedMcpResource,
  splitOrgScopeMarker,
  withOrgScopedMcpResource,
} from '@getmunin/core';
import { mcpResourceUrl } from './oauth/oauth.constants.ts';
import { hasOrgScopeAssociationKey, orgScopeStore } from './auth/org-scope-store.ts';

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
    const fetchRequest = expressRequestToFetch(
      req,
      narrowAuthRequestBody(req),
      narrowOrgMarkerQuery(req),
    );
    const fetchResponse = await auth.handler(fetchRequest);
    await pipeFetchResponseToExpress(fetchResponse, res);
  });
}

export async function resolveMcpOrgScope(req: ExpressRequest): Promise<McpOrgScopeInput> {
  const store = orgScopeStore();
  const keys = store?.keysFor(req.headers?.['cookie'], readCodeChallenge(req)) ?? null;
  const requestedOrgId = readRequestedOrgId(req);

  if (requestedOrgId) {
    if (store && hasOrgScopeAssociationKey(keys)) {
      try {
        await store.remember(keys!, requestedOrgId);
      } catch (err) {
        console.warn('[auth] could not carry the requested org across the consent step', { err });
      }
    }
    return { resource: orgScopedMcpResourceUrl(requestedOrgId) };
  }

  if (store && hasOrgScopeAssociationKey(keys)) {
    try {
      const orgId = await store.recall(keys!);
      if (orgId) return { resource: orgScopedMcpResourceUrl(orgId) };
    } catch (err) {
      console.warn('[auth] could not recall the org this authorization was started for', { err });
    }
  }
  return { resource: null };
}

export function readRequestedOrgId(req: ExpressRequest): string | null {
  const requested = readRequestedResource(req);
  const fromResource = requested ? parseOrgScopedMcpResource(requested) : null;
  if (fromResource) return fromResource;
  const scope = readRequestedScope(req);
  return scope ? splitOrgScopeMarker(scope).orgId : null;
}

export function readRequestedScope(req: ExpressRequest): string | null {
  const fromQuery = firstString(req.query?.['scope']);
  if (fromQuery) return fromQuery;
  return firstString(readObjectBody(req)?.['scope']);
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

export function narrowAuthRequestBody(req: ExpressRequest): BodyOverride | null {
  const body = readObjectBody(req);
  if (!body) return null;

  const resource = firstString(body['resource']);
  const narrowedResource =
    resource && parseOrgScopedMcpResource(resource) ? mcpResourceUrl() : null;
  const scope = firstString(body['scope']);
  const split = scope ? splitOrgScopeMarker(scope) : null;
  const narrowedScope = split?.orgId ? split.scopes : null;
  if (!narrowedResource && narrowedScope === null) return null;

  const contentType = req.headers['content-type']?.toString() ?? '';
  const rawBody = (req as ExpressRequest & { rawBody?: Buffer }).rawBody;
  if (contentType.includes('application/x-www-form-urlencoded') && rawBody?.length) {
    const params = new URLSearchParams(rawBody.toString('utf8'));
    if (narrowedResource) params.set('resource', narrowedResource);
    if (narrowedScope !== null) {
      if (narrowedScope) params.set('scope', narrowedScope);
      else params.delete('scope');
    }
    return { contentType: 'application/x-www-form-urlencoded', body: params.toString() };
  }

  const narrowed: Record<string, unknown> = { ...body };
  if (narrowedResource) narrowed['resource'] = narrowedResource;
  if (narrowedScope !== null) {
    if (narrowedScope) narrowed['scope'] = narrowedScope;
    else delete narrowed['scope'];
  }
  return { contentType: 'application/json', body: JSON.stringify(narrowed) };
}

export function narrowOrgMarkerQuery(req: ExpressRequest): string | null {
  const scope = firstString(req.query?.['scope']);
  if (!scope) return null;
  const { orgId, scopes } = splitOrgScopeMarker(scope);
  if (!orgId) return null;
  const params = new URLSearchParams(queryStringOf(req));
  if (scopes) params.set('scope', scopes);
  else params.delete('scope');
  return params.toString();
}

function queryStringOf(req: ExpressRequest): string {
  const raw = req.originalUrl ?? req.url ?? '';
  const at = raw.indexOf('?');
  return at < 0 ? '' : raw.slice(at + 1);
}

function pathOf(url: string): string {
  const at = url.indexOf('?');
  return at < 0 ? url : url.slice(0, at);
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
  queryOverride: string | null = null,
): globalThis.Request {
  const protocol = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
  const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
  const path =
    queryOverride === null
      ? req.originalUrl
      : `${pathOf(req.originalUrl)}${queryOverride ? `?${queryOverride}` : ''}`;
  const url = `${protocol}://${host}${path}`;
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
