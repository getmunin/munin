import {
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { describeError, safeFetch, SsrfBlockedError } from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { authorizationServerUrl } from './oauth.constants.ts';

interface OAuthClientInfo {
  client_id: string;
  name: string | null;
  uri: string | null;
  icon_url: string;
  redirect_uri_host: string | null;
  created_at: string;
}

const KNOWN_HOST_NAMES: Record<string, string> = {
  'claude.ai': 'Claude',
  'chatgpt.com': 'ChatGPT',
  'openai.com': 'ChatGPT',
  'cursor.sh': 'Cursor',
  'cursor.com': 'Cursor',
};

const FAVICON_MIME_ALLOWLIST = new Set([
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export const FAVICON_MAX_BYTES = 256 * 1024;
const FAVICON_BROWSER_TTL_SECONDS = 60 * 60 * 24;

export const ICON_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
  'content-disposition': 'inline; filename="icon"',
  'cache-control': `public, max-age=${FAVICON_BROWSER_TTL_SECONDS}`,
};

export interface IconResponse {
  status(code: number): IconResponse;
  setHeader(name: string, value: string): IconResponse;
  send(body: Buffer): unknown;
}

export interface FetchedIcon {
  body: Buffer;
  mime: string;
}

export interface IconFetchResponse {
  ok: boolean;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type IconFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<IconFetchResponse>;

@PublicController('v1/oauth/clients')
export class OAuthClientInfoController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(':clientId')
  @Header('cache-control', 'public, max-age=60')
  async lookup(@Param('clientId') clientId: string): Promise<OAuthClientInfo> {
    const row = await this.loadRow(clientId);
    const redirectHost = firstRedirectHost(row.redirectUris);
    const name = row.name?.trim() ? row.name : deriveFallbackName(redirectHost);
    return {
      client_id: row.clientId,
      name,
      uri: row.uri ?? null,
      icon_url: `${authorizationServerUrl()}/v1/oauth/clients/${encodeURIComponent(row.clientId)}/icon`,
      redirect_uri_host: redirectHost,
      created_at: row.createdAt.toISOString(),
    };
  }

  @Get(':clientId/icon')
  async icon(@Param('clientId') clientId: string, @Res() res: Response): Promise<void> {
    const row = await this.loadRow(clientId);
    sendIcon(res, await this.resolveIcon(row));
  }

  private async loadRow(clientId: string): Promise<{
    clientId: string;
    name: string | null;
    uri: string | null;
    icon: string | null;
    redirectUris: string[];
    createdAt: Date;
  }> {
    const rows = await this.db
      .select({
        clientId: schema.oauthClient.clientId,
        name: schema.oauthClient.name,
        uri: schema.oauthClient.uri,
        icon: schema.oauthClient.icon,
        redirectUris: schema.oauthClient.redirectUris,
        disabled: schema.oauthClient.disabled,
        createdAt: schema.oauthClient.createdAt,
      })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, clientId))
      .limit(1);
    const row = rows[0];
    if (!row || row.disabled) throw new NotFoundException('oauth_client_not_found');
    return {
      clientId: row.clientId,
      name: row.name ?? null,
      uri: row.uri ?? null,
      icon: row.icon ?? null,
      redirectUris: row.redirectUris ?? [],
      createdAt: row.createdAt,
    };
  }

  private async resolveIcon(row: {
    icon: string | null;
    redirectUris: string[];
  }): Promise<{ body: Buffer; mime: string } | null> {
    const fromUri = row.icon?.trim() ? row.icon.trim() : null;
    if (fromUri) {
      const fetched = await fetchImage(fromUri);
      if (fetched) return fetched;
    }
    const host = firstRedirectHost(row.redirectUris);
    if (!host) return null;
    return fetchImage(`https://${host}/favicon.ico`);
  }
}

function firstRedirectHost(redirectUris: string[] | null | undefined): string | null {
  const first = redirectUris?.[0];
  if (!first) return null;
  try {
    return new URL(first).hostname;
  } catch {
    return null;
  }
}

function deriveFallbackName(host: string | null): string | null {
  if (!host) return null;
  const known = KNOWN_HOST_NAMES[host];
  if (known) return known;
  return host.replace(/^www\./, '');
}

export function sendIcon(res: IconResponse, icon: FetchedIcon | null): void {
  res.status(200);
  for (const [name, value] of Object.entries(ICON_RESPONSE_HEADERS)) res.setHeader(name, value);
  if (!icon) {
    res.setHeader('content-type', 'image/svg+xml').send(GENERIC_APP_ICON_SVG);
    return;
  }
  res.setHeader('content-type', icon.mime).send(icon.body);
}

export async function readCappedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

const defaultIconFetcher: IconFetcher = (url, init) => safeFetch(url, init);

export async function fetchImage(
  url: string,
  fetcher: IconFetcher = defaultIconFetcher,
): Promise<FetchedIcon | null> {
  let res: IconFetchResponse;
  try {
    res = await fetcher(url, {
      method: 'GET',
      headers: { 'user-agent': 'Munin-Consent/1.0 (+https://getmunin.com)' },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      console.warn(`[oauth-client-icon] ssrf blocked for ${url}: ${err.message}`);
    } else {
      console.warn(`[oauth-client-icon] fetch failed for ${url}: ${describeError(err)}`);
    }
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  const rawMime = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!FAVICON_MIME_ALLOWLIST.has(rawMime)) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > FAVICON_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  let buf: Buffer | null;
  try {
    buf = await readCappedBody(res.body, FAVICON_MAX_BYTES);
  } catch (err) {
    console.warn(`[oauth-client-icon] body read failed for ${url}: ${describeError(err)}`);
    return null;
  }
  if (!buf || buf.length === 0) return null;
  return { body: buf, mime: rawMime };
}

const GENERIC_APP_ICON_SVG = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="12" fill="#1c1f24"/>
  <path d="M20 22h24v4H20zM20 30h24v4H20zM20 38h16v4H20z" fill="#ffffff" opacity="0.9"/>
</svg>`,
  'utf8',
);
