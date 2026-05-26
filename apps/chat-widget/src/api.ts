import type { WidgetVisitor } from './config.ts';

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
  visitorId?: string;
  identity?: ApiIdentity;
  visitor?: WidgetVisitor;
  fetchImpl?: typeof fetch;
}

export interface ListedMessage {
  id: string;
  role: 'end_user' | 'agent' | 'system';
  authorKind: 'ai' | 'human' | null;
  authorName: string | null;
  body: string;
  bodyHtml: string | null;
  at: string;
  readAt: string | null;
}

export interface ConversationEnvelope {
  id: string;
  subject: string | null;
  status: string;
  handedOver: boolean;
  assigneeName: string | null;
  contactEmail: string | null;
}

export interface BackfillResult {
  messages: ListedMessage[];
  hasMore: boolean;
  conversation: ConversationEnvelope | null;
}

export interface ConversationSummary {
  id: string;
  sessionId: string;
  title: string;
  preview: string;
  status: string;
  handedOver: boolean;
  lastMessageAt: string | null;
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

export type VoiceStartResult =
  | { available: false; reason: string }
  | {
      available: true;
      descriptor: {
        vendor: 'vapi';
        publicKey: string;
        assistantId: string;
        metadata: { conversationId: string; endUserId: string };
        assistant?: Record<string, unknown>;
        assistantOverrides?: Record<string, unknown>;
      };
    };

export interface VoiceEventInput {
  conversationId: string;
  kind: 'started' | 'ended';
  durationSeconds?: number;
}

export interface ApiClient {
  postMessage(text: string): Promise<PostResult>;
  backfillSince(since: Date | undefined): Promise<BackfillResult>;
  listConversations(sessionIds: string[]): Promise<ConversationSummary[]>;
  setVisitorEmail(email: string): Promise<void>;
  startConversation(): Promise<{ conversationId: string; displayId: number; contactId: string }>;
  voiceStart(conversationId: string): Promise<VoiceStartResult>;
  voiceEvent(input: VoiceEventInput): Promise<void>;
  setSessionId(sessionId: string): void;
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = `${deps.host}/api/v1/widget`;
  const messagesUrl = `${base}/messages`;
  const conversationsUrl = `${base}/conversations`;
  const visitorUrl = `${base}/visitor`;

  let sessionId = deps.sessionId;

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${deps.widgetKey}`,
      'Content-Type': 'application/json',
    };
  }

  function ingestPayload(text: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      channelId: deps.channelId,
      sessionId,
      messages: [{ role: 'end_user', body: text }],
    };
    if (deps.visitorId) payload.visitorId = deps.visitorId;
    if (deps.identity) {
      payload.verifiedExternalId = deps.identity.externalId;
      payload.userHash = deps.identity.userHash;
    }
    if (deps.visitor) payload.visitor = deps.visitor;
    return payload;
  }

  return {
    setSessionId(next) {
      sessionId = next;
    },

    async postMessage(text) {
      const res = await fetchImpl(messagesUrl, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(ingestPayload(text)),
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
      return (await res.json()) as PostResult;
    },

    async backfillSince(since) {
      const url = new URL(messagesUrl);
      url.searchParams.set('channelId', deps.channelId);
      url.searchParams.set('sessionId', sessionId);
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

    async listConversations(sessionIds) {
      const url = new URL(conversationsUrl);
      url.searchParams.set('channelId', deps.channelId);
      if (sessionIds.length > 0) {
        url.searchParams.set('sessionIds', sessionIds.join(','));
      }
      if (deps.identity) {
        url.searchParams.set('verifiedExternalId', deps.identity.externalId);
        url.searchParams.set('userHash', deps.identity.userHash);
      }
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${deps.widgetKey}` },
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
      const body = (await res.json()) as { conversations: ConversationSummary[] };
      return body.conversations;
    },

    async startConversation() {
      const payload: Record<string, unknown> = {
        channelId: deps.channelId,
        sessionId,
      };
      if (deps.visitorId) payload.visitorId = deps.visitorId;
      if (deps.identity) {
        payload.verifiedExternalId = deps.identity.externalId;
        payload.userHash = deps.identity.userHash;
      }
      if (deps.visitor) payload.visitor = deps.visitor;
      const res = await fetchImpl(conversationsUrl, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
      return (await res.json()) as { conversationId: string; displayId: number; contactId: string };
    },

    async setVisitorEmail(email) {
      const payload: Record<string, unknown> = {
        channelId: deps.channelId,
        sessionId,
        email,
      };
      if (deps.visitorId) payload.visitorId = deps.visitorId;
      if (deps.identity) {
        payload.verifiedExternalId = deps.identity.externalId;
        payload.userHash = deps.identity.userHash;
      }
      const res = await fetchImpl(visitorUrl, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
    },

    async voiceStart(conversationId) {
      const res = await fetchImpl(`${base}/voice/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ channelId: deps.channelId, conversationId }),
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
      return (await res.json()) as VoiceStartResult;
    },

    async voiceEvent({ conversationId, kind, durationSeconds }) {
      const payload: Record<string, unknown> = {
        channelId: deps.channelId,
        conversationId,
        kind,
      };
      if (typeof durationSeconds === 'number') payload.durationSeconds = durationSeconds;
      const res = await fetchImpl(`${base}/voice/event`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new WidgetApiError(res.status, await safeJson(res));
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
