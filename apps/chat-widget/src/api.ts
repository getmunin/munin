import type { WidgetVisitor } from './config.js';

/**
 * Thin REST client for the widget's two endpoints:
 *   POST /api/v1/widget/messages   — visitor sends a message
 *   GET  /api/v1/widget/messages   — one-shot reconnect backfill
 *
 * The client is **not** a polling primitive. The realtime client calls
 * `backfillSince()` exactly once per (re)connect; live updates flow over
 * the WebSocket. If you find yourself adding `setInterval` on a method
 * here, stop — the design says no polling.
 *
 * The channel + identity attributes are baked into the client at
 * construction so the rest of the widget code doesn't have to thread
 * them through every call.
 */

export interface ApiIdentity {
  externalId: string;
  userHash: string;
}

export interface ApiClientDeps {
  host: string;
  widgetKey: string;
  channelId: string;
  sessionId: string;
  identity?: ApiIdentity;
  visitor?: WidgetVisitor;
  /** Override `fetch` for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export interface ListedMessage {
  id: string;
  role: 'end_user' | 'agent' | 'system';
  body: string;
  bodyHtml: string | null;
  at: string;
}

export interface BackfillResult {
  messages: ListedMessage[];
  hasMore: boolean;
}

export interface PostResult {
  conversationId: string;
  displayId: number;
  contactId: string;
  inserted: number;
  skipped: number;
}

export class WidgetApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`widget api ${status}`);
    this.name = 'WidgetApiError';
  }
}

export interface ApiClient {
  postMessage(text: string): Promise<PostResult>;
  backfillSince(since: Date | undefined): Promise<BackfillResult>;
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const restBase = `${deps.host}/api/v1/widget/messages`;

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${deps.widgetKey}`,
      'Content-Type': 'application/json',
    };
  }

  function ingestPayload(text: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      channelId: deps.channelId,
      sessionId: deps.sessionId,
      messages: [{ role: 'end_user', body: text }],
    };
    if (deps.identity) {
      payload.verifiedExternalId = deps.identity.externalId;
      payload.userHash = deps.identity.userHash;
    }
    if (deps.visitor) payload.visitor = deps.visitor;
    return payload;
  }

  return {
    async postMessage(text) {
      const res = await fetchImpl(restBase, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(ingestPayload(text)),
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
      return (await res.json()) as PostResult;
    },

    async backfillSince(since) {
      const url = new URL(restBase);
      url.searchParams.set('channelId', deps.channelId);
      url.searchParams.set('sessionId', deps.sessionId);
      if (since) url.searchParams.set('since', since.toISOString());
      if (deps.identity) {
        url.searchParams.set('verifiedExternalId', deps.identity.externalId);
        url.searchParams.set('userHash', deps.identity.userHash);
      }
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${deps.widgetKey}` },
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
      return (await res.json()) as BackfillResult;
    },
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
