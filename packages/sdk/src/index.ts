/**
 * @munin/sdk — typed client for the Munin REST API.
 *
 * Used by an org's backend (server-to-server, holding an admin API key) to
 * mint delegated end-user tokens, look up end-users, fetch the pre-fetch
 * context summary, and configure webhooks.
 *
 * Example:
 *   const munin = createMuninClient({
 *     baseUrl: 'https://api.getmunin.com',
 *     adminApiKey: process.env.MUNIN_ADMIN_API_KEY!,
 *   });
 *   const { accessToken } = await munin.mintEndUserToken({ externalId: '+47...' });
 */

export interface MuninClientOptions {
  baseUrl: string;
  adminApiKey: string;
  /** Override fetch (useful for tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface MintEndUserTokenInput {
  externalId?: string;
  endUserId?: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
  audiences?: ('admin' | 'self_service')[];
}

export interface MintEndUserTokenResult {
  accessToken: string;
  endUserId: string;
  expiresAt: string;
  scopes: string[];
  audiences: string[];
}

export interface LookupEndUserInput {
  externalId?: string;
  email?: string;
  phone?: string;
}

export interface EndUser {
  id: string;
  externalId?: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata: Record<string, unknown>;
}

export interface EndUserContext {
  contact?: Record<string, unknown>;
  recentTickets?: unknown[];
  recentActivities?: unknown[];
  openDeals?: unknown[];
  suggestedKbArticles?: unknown[];
  doNotContact?: boolean;
  preferredChannel?: string;
  metadata?: Record<string, unknown>;
}

export interface MuninClient {
  mintEndUserToken(input: MintEndUserTokenInput): Promise<MintEndUserTokenResult>;
  lookupEndUser(input: LookupEndUserInput): Promise<EndUser | null>;
  getEndUserContext(endUserId: string): Promise<EndUserContext>;
  revokeToken(tokenId: string): Promise<void>;
}

export function createMuninClient(opts: MuninClientOptions): MuninClient {
  const { baseUrl, adminApiKey } = opts;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('No fetch implementation available. Pass opts.fetch or run on Node 18+.');
  }

  const trimmedBase = baseUrl.replace(/\/+$/, '');

  async function call<T>(
    path: string,
    init: Omit<RequestInit, 'body'> & { body?: unknown },
  ): Promise<T> {
    const { body, ...rest } = init;
    const res = await fetchImpl(`${trimmedBase}${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminApiKey}`,
        ...rest.headers,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new MuninApiError(res.status, `${res.status} ${res.statusText}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    mintEndUserToken: (input) =>
      call<MintEndUserTokenResult>('/api/delegated-token', { method: 'POST', body: input }),
    lookupEndUser: (input) =>
      call<EndUser | null>('/api/end-users/lookup', { method: 'POST', body: input }),
    getEndUserContext: (endUserId) =>
      call<EndUserContext>(`/api/end-users/${encodeURIComponent(endUserId)}/context`, {
        method: 'GET',
      }),
    revokeToken: (tokenId) =>
      call<void>(`/api/tokens/${encodeURIComponent(tokenId)}/revoke`, { method: 'POST' }),
  };
}

export class MuninApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'MuninApiError';
  }
}
