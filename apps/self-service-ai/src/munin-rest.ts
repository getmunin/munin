import type { ConversationMessage } from '@getmunin/agent-runtime';

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

export interface MuninRestClient {
  getConversation(id: string): Promise<ConversationDetail>;
  postAgentMessage(conversationId: string, body: string): Promise<void>;
  mintDelegatedToken(endUserId: string, ttlSeconds?: number): Promise<DelegatedToken>;
  toRuntimeHistory(detail: ConversationDetail): ConversationMessage[];
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
    async postAgentMessage(conversationId: string, body: string): Promise<void> {
      await call<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    },
    async mintDelegatedToken(endUserId: string, ttlSeconds = 600): Promise<DelegatedToken> {
      return call<DelegatedToken>('/api/delegated-token', {
        method: 'POST',
        body: JSON.stringify({
          endUserId,
          audiences: ['self_service'],
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
  };
}
