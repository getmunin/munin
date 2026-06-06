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
  'image/svg+xml',
  'image/webp',
]);

const FAVICON_MAX_BYTES = 256 * 1024;
const FAVICON_BROWSER_TTL_SECONDS = 60 * 60 * 24;

/**
 * Public lookup for the disclosure fields of a registered OAuth client.
 * The consent page renders the client's human-facing name + URL + logo
 * instead of the random RFC 7591 `client_id`. Strictly disclosure-only:
 * we never return `clientSecret`, the full `redirectUris`, or anything
 * else the caller could weaponize — only the host portion of the first
 * redirect URI so the page can render "Returning to claude.ai/...".
 *
 * Anonymous on purpose — the consent page is rendered for any user
 * mid-authorization, before the OAuth flow has issued any credential.
 */
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
    const icon = await this.resolveIcon(row);
    if (!icon) {
      res
        .status(200)
        .setHeader('content-type', 'image/svg+xml')
        .setHeader('cache-control', `public, max-age=${FAVICON_BROWSER_TTL_SECONDS}`)
        .send(GENERIC_APP_ICON_SVG);
      return;
    }
    res
      .status(200)
      .setHeader('content-type', icon.mime)
      .setHeader('cache-control', `public, max-age=${FAVICON_BROWSER_TTL_SECONDS}`)
      .send(icon.body);
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
  // strip leading www. and return the host so the user sees *something* identifiable
  return host.replace(/^www\./, '');
}

async function fetchImage(url: string): Promise<{ body: Buffer; mime: string } | null> {
  let res: Awaited<ReturnType<typeof safeFetch>>;
  try {
    res = await safeFetch(url, {
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
  if (!res.ok) return null;
  const rawMime = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!FAVICON_MIME_ALLOWLIST.has(rawMime)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > FAVICON_MAX_BYTES) return null;
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
