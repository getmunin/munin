import type { ConversationMessage } from './types.js';

export interface ConversationDetail {
  id: string;
  status: 'open' | 'snoozed' | 'closed' | 'spam';
  channelType?: string;
  endUserId: string | null;
  assigneeUserId: string | null;
  messages: Array<{
    id: string;
    authorType: 'user' | 'agent' | 'end_user' | 'system';
    body: string;
    createdAt: string;
    internal?: boolean;
  }>;
}

export interface DelegatedToken {
  accessToken: string;
  endUserId: string;
  expiresAt: string;
}

export type ConversationStatus = 'open' | 'snoozed' | 'closed' | 'spam';

export interface ConversationTopic {
  id: string;
  slug: string;
  name: string;
  color?: string | null;
}

export interface MuninRestClient {
  getConversation(id: string): Promise<ConversationDetail>;
  postAgentMessage(
    conversationId: string,
    body: string,
    opts?: { preserveAttention?: boolean },
  ): Promise<void>;
  postInternalNote(conversationId: string, body: string): Promise<void>;
  mintDelegatedToken(endUserId: string, ttlSeconds?: number): Promise<DelegatedToken>;
  toRuntimeHistory(detail: ConversationDetail): ConversationMessage[];
  changeStatus(conversationId: string, status: ConversationStatus, snoozeUntil?: string): Promise<void>;
  setTopic(conversationId: string, topicId: string | null): Promise<void>;
  listTopics(): Promise<ConversationTopic[]>;
}

export interface CreateMuninRestClientOptions {
  baseUrl: string;
  adminApiKey: string;
  fetch?: typeof fetch;
}

export function createMuninRestClient(opts: CreateMuninRestClientOptions): MuninRestClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${opts.adminApiKey}`,
    };
    if (init.body && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    const res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`munin ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    async getConversation(id: string): Promise<ConversationDetail> {
      return call<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`);
    },
    async postAgentMessage(
      conversationId: string,
      body: string,
      opts: { preserveAttention?: boolean } = {},
    ): Promise<void> {
      await call<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          ...(opts.preserveAttention ? { preserveAttention: true } : {}),
        }),
      });
    },
    async postInternalNote(conversationId: string, body: string): Promise<void> {
      await call<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body, internal: true }),
      });
    },
    async mintDelegatedToken(endUserId: string, ttlSeconds = 600): Promise<DelegatedToken> {
      return call<DelegatedToken>('/api/delegated-token', {
        method: 'POST',
        body: JSON.stringify({
          endUserId,
          audiences: ['self_service'],
          scopes: ['conv:read', 'conv:write', 'kb:read', 'crm:read'],
          ttlSeconds,
        }),
      });
    },
    toRuntimeHistory(detail: ConversationDetail): ConversationMessage[] {
      return detail.messages
        .filter((m) => !m.internal)
        .map((m) => ({
          authorType: m.authorType,
          body: m.body,
          createdAt: m.createdAt,
        }));
    },
    async changeStatus(
      conversationId: string,
      status: ConversationStatus,
      snoozeUntil?: string,
    ): Promise<void> {
      const body: Record<string, unknown> = { status };
      if (snoozeUntil) body.snoozeUntil = snoozeUntil;
      await call<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/status`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    async setTopic(conversationId: string, topicId: string | null): Promise<void> {
      await call<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/topic`, {
        method: 'POST',
        body: JSON.stringify({ topicId }),
      });
    },
    async listTopics(): Promise<ConversationTopic[]> {
      return call<ConversationTopic[]>(`/api/conversations/topics`);
    },
  };
}
