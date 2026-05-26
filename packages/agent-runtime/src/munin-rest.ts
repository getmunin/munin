import type { ConversationMessage } from './types.ts';

export interface ConversationDetail {
  id: string;
  status: 'open' | 'snoozed' | 'closed' | 'spam';
  channelType?: string;
  endUserId: string | null;
  assigneeUserId: string | null;
  claim: {
    holderType: 'user' | 'agent';
    holderId: string;
    expiresAt: string;
  } | null;
  agentMode?: 'auto' | 'draft_only' | 'off';
  voiceActive?: boolean;
  outreachCampaignId?: string | null;
  assistantName?: string | null;
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

export type CuratorJobStatus =
  | 'pending'
  | 'done'
  | 'failed'
  | 'dead'
  | 'failed_retryable';

export interface CuratorJob {
  id: string;
  orgId: string;
  jobUri: string;
  userPrompt: string;
  sourceEventType: string | null;
  sourceEventPayload: unknown;
  dedupeKey: string | null;
  status: CuratorJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseExpiresAt: string | null;
  leaseHolder: string | null;
  lastError: string | null;
  lastReplyText: string | null;
  lastToolCalls: number | null;
  lastTotalTokens: number | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  assistantName: string | null;
}

export interface EnqueueCuratorJobInput {
  jobUri: string;
  userPrompt: string;
  sourceEventType?: string;
  sourceEventPayload?: unknown;
  dedupeKey?: string;
  maxAttempts?: number;
  delaySeconds?: number;
}

export interface ClaimCuratorJobsInput {
  holder: string;
  limit?: number;
  leaseSeconds?: number;
}

export interface AckCuratorJobInput {
  replyText?: string;
  toolCalls?: number;
  totalTokens?: number;
}

export interface FailCuratorJobInput {
  error: string;
  retryable?: boolean;
  code?: string;
  failedStep?: string;
}

export interface MuninRestClient {
  getConversation(id: string): Promise<ConversationDetail>;
  postAgentMessage(
    conversationId: string,
    body: string,
    opts?: { preserveAttention?: boolean; sinceMessageId?: string },
  ): Promise<void>;
  tryAcquireConversation(input: {
    conversationId: string;
    holder: string;
    leaseSeconds?: number;
  }): Promise<{ acquired: boolean; leaseExpiresAt?: string; heldBy?: string | null }>;
  releaseConversationClaim(input: {
    conversationId: string;
    holder: string;
  }): Promise<{ released: boolean }>;
  postInternalNote(conversationId: string, body: string): Promise<void>;
  mintDelegatedToken(endUserId: string, ttlSeconds?: number): Promise<DelegatedToken>;
  toRuntimeHistory(detail: ConversationDetail): ConversationMessage[];
  changeStatus(conversationId: string, status: ConversationStatus, snoozeUntil?: string): Promise<void>;
  setTopic(conversationId: string, topicId: string | null): Promise<void>;
  listTopics(): Promise<ConversationTopic[]>;
  enqueueCuratorJob(input: EnqueueCuratorJobInput): Promise<{ job: CuratorJob; alreadyPending: boolean }>;
  claimCuratorJobs(input: ClaimCuratorJobsInput): Promise<CuratorJob[]>;
  ackCuratorJob(id: string, input?: AckCuratorJobInput): Promise<CuratorJob>;
  failCuratorJob(id: string, input: FailCuratorJobInput): Promise<CuratorJob>;
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
      'user-agent': '@getmunin/agent-runtime',
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
      return call<ConversationDetail>(`/api/v1/conversations/${encodeURIComponent(id)}`);
    },
    async postAgentMessage(
      conversationId: string,
      body: string,
      opts: { preserveAttention?: boolean; sinceMessageId?: string } = {},
    ): Promise<void> {
      await call<unknown>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          ...(opts.preserveAttention ? { preserveAttention: true } : {}),
          ...(opts.sinceMessageId ? { sinceMessageId: opts.sinceMessageId } : {}),
        }),
      });
    },
    async tryAcquireConversation(input): Promise<{ acquired: boolean; leaseExpiresAt?: string; heldBy?: string | null }> {
      return call<{ acquired: boolean; leaseExpiresAt?: string; heldBy?: string | null }>(
        `/api/v1/conversations/${encodeURIComponent(input.conversationId)}/runner-claim`,
        {
          method: 'POST',
          body: JSON.stringify({
            holder: input.holder,
            ...(input.leaseSeconds ? { leaseSeconds: input.leaseSeconds } : {}),
          }),
        },
      );
    },
    async releaseConversationClaim(input): Promise<{ released: boolean }> {
      return call<{ released: boolean }>(
        `/api/v1/conversations/${encodeURIComponent(input.conversationId)}/runner-release`,
        {
          method: 'POST',
          body: JSON.stringify({ holder: input.holder }),
        },
      );
    },
    async postInternalNote(conversationId: string, body: string): Promise<void> {
      await call<unknown>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body, internal: true }),
      });
    },
    async mintDelegatedToken(endUserId: string, ttlSeconds = 600): Promise<DelegatedToken> {
      return call<DelegatedToken>('/api/v1/tokens/delegated', {
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
          body:
            m.authorType === 'user'
              ? `[human teammate] ${m.body}`
              : m.body,
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
      await call<unknown>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/status`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    async setTopic(conversationId: string, topicId: string | null): Promise<void> {
      await call<unknown>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/topic`, {
        method: 'POST',
        body: JSON.stringify({ topicId }),
      });
    },
    async listTopics(): Promise<ConversationTopic[]> {
      return call<ConversationTopic[]>(`/api/v1/conversations/topics`);
    },
    async enqueueCuratorJob(
      input: EnqueueCuratorJobInput,
    ): Promise<{ job: CuratorJob; alreadyPending: boolean }> {
      return call<{ job: CuratorJob; alreadyPending: boolean }>(`/api/v1/curation/jobs`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async claimCuratorJobs(input: ClaimCuratorJobsInput): Promise<CuratorJob[]> {
      const result = await call<{ items: CuratorJob[] }>(`/api/v1/curation/jobs/claim`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return result.items;
    },
    async ackCuratorJob(id: string, input: AckCuratorJobInput = {}): Promise<CuratorJob> {
      return call<CuratorJob>(`/api/v1/curation/jobs/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async failCuratorJob(id: string, input: FailCuratorJobInput): Promise<CuratorJob> {
      return call<CuratorJob>(`/api/v1/curation/jobs/${encodeURIComponent(id)}/fail`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
