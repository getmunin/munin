import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  AuditLogger,
  RequestContextStore,
  buildAdminAgentActor,
  type ActorIdentity,
  type RequestContext,
} from '@getmunin/core';
import { type Db } from '@getmunin/db';
import { type WebImportProgress } from '@getmunin/types';
import {
  type AckCuratorJobInput,
  type AwaitingReplyConversation,
  type ClaimCuratorJobsInput,
  type ConversationDetail,
  type ConversationStatus,
  type ConversationTopic,
  type CuratorJob,
  type DelegatedToken,
  type EnqueueCuratorJobInput,
  type FailCuratorJobInput,
  type MuninRestClient,
  type UpdateCuratorJobProgressInput,
} from '@getmunin/agent-runtime';
import type { ConversationMessage } from '@getmunin/agent-runtime';
import { ConvService } from '../modules/conv/conv.service.ts';
import { CuratorJobsService } from '../modules/curator/curator-jobs.service.ts';
import { DB } from '../common/db/db.module.ts';
import { applyTenancyGUCs } from '../common/tenancy/tenancy.interceptor.ts';

export type MuninRestClientFactory = (orgId: string) => MuninRestClient;

@Injectable()
export class InProcessMuninRestClientFactoryService {
  private readonly audit = new AuditLogger();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly conv: ConvService,
    private readonly curator: CuratorJobsService,
  ) {}

  forOrg(orgId: string): MuninRestClient {
    return buildClient({
      db: this.db,
      audit: this.audit,
      conv: this.conv,
      curator: this.curator,
      actor: buildAdminAgentActor(orgId),
    });
  }
}

interface BuildOptions {
  db: Db;
  audit: AuditLogger;
  conv: ConvService;
  curator: CuratorJobsService;
  actor: ActorIdentity;
}

function buildClient(opts: BuildOptions): MuninRestClient {
  function withTenancy<T>(fn: () => Promise<T>): Promise<T> {
    return opts.db.transaction(async (tx) => {
      await applyTenancyGUCs(tx, opts.actor);
      const ctx: RequestContext = { db: tx, actor: opts.actor, correlationId: randomUUID() };
      return RequestContextStore.run(ctx, fn);
    });
  }

  async function audited<T>(
    method: string,
    fn: () => Promise<T>,
    extra: { totalTokens?: number } = {},
  ): Promise<T> {
    const startedAt = Date.now();
    return withTenancy(async () => {
      try {
        const result = await fn();
        await opts.audit.record({
          method,
          result: 'ok',
          durationMs: Date.now() - startedAt,
          totalTokens: extra.totalTokens,
          userAgent: 'in-process:agent-host',
        });
        return result;
      } catch (err) {
        await opts.audit.record({
          method,
          result: 'error',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startedAt,
          totalTokens: extra.totalTokens,
          userAgent: 'in-process:agent-host',
        });
        throw err;
      }
    });
  }

  return {
    async getConversation(id: string): Promise<ConversationDetail> {
      return audited('runner:getConversation', async () => {
        const detail = await opts.conv.getConversation(id);
        return {
          id: detail.id,
          status: detail.status,
          channelType: detail.channelType,
          endUserId: detail.endUserId,
          assigneeUserId: detail.assigneeUserId,
          claim: null,
          agentMode: detail.agentMode,
          voiceActive: detail.voiceActive,
          outreachCampaignId: detail.outreachCampaignId,
          assistantName: detail.assistantName,
          endUserLocale: detail.endUserLocale,
          messages: detail.messages.map((m) => ({
            id: m.id,
            authorType: m.authorType,
            body: m.body,
            createdAt: m.createdAt,
            internal: m.internal,
          })),
        };
      });
    },

    async listConversationsAwaitingReply(
      input: { limit?: number; lookbackMinutes?: number } = {},
    ): Promise<AwaitingReplyConversation[]> {
      return withTenancy(() => opts.conv.listConversationsAwaitingAgentReply(input));
    },

    async postAgentMessage(
      conversationId: string,
      body: string,
      messageOpts: { preserveAttention?: boolean; sinceMessageId?: string; totalTokens?: number } = {},
    ): Promise<void> {
      await audited(
        'runner:postAgentMessage',
        async () => {
          await opts.conv.sendMessage({
            conversationId,
            body,
            authorType: 'agent',
            authorId: opts.actor.id,
            preserveAttention: messageOpts.preserveAttention,
            sinceMessageId: messageOpts.sinceMessageId,
          });
        },
        { totalTokens: messageOpts.totalTokens },
      );
    },

    async postInternalNote(conversationId: string, body: string): Promise<void> {
      await audited('runner:postInternalNote', async () => {
        await opts.conv.sendMessage({
          conversationId,
          body,
          internal: true,
          authorType: 'agent',
          authorId: opts.actor.id,
        });
      });
    },

    async requestHandover(
      conversationId: string,
      input: { reason?: string; publicFallbackMessage?: string },
    ): Promise<void> {
      await audited('runner:requestHandover', async () => {
        await opts.conv.requestHandover({
          conversationId,
          reason: input.reason,
          publicFallbackMessage: input.publicFallbackMessage,
        });
      });
    },

    async tryAcquireConversation(input: {
      conversationId: string;
      holder: string;
      leaseSeconds?: number;
    }): Promise<{ acquired: boolean; leaseExpiresAt?: string; heldBy?: string | null }> {
      return audited('runner:tryAcquireConversation', () =>
        opts.conv.tryAcquireConversation({
          conversationId: input.conversationId,
          holder: input.holder,
          leaseSeconds: input.leaseSeconds ?? 60,
        }),
      );
    },

    async releaseConversationClaim(input: {
      conversationId: string;
      holder: string;
    }): Promise<{ released: boolean }> {
      return audited('runner:releaseConversationClaim', () =>
        opts.conv.releaseConversationClaim(input),
      );
    },

    async changeStatus(
      conversationId: string,
      status: ConversationStatus,
      snoozeUntil?: string,
    ): Promise<void> {
      await audited('runner:changeStatus', async () => {
        await opts.conv.changeStatus({ id: conversationId, status, snoozeUntil });
      });
    },

    async setTopic(conversationId: string, topicId: string | null): Promise<void> {
      await audited('runner:setTopic', async () => {
        await opts.conv.setTopic({ conversationId, topicId });
      });
    },

    async listTopics(): Promise<ConversationTopic[]> {
      return audited('runner:listTopics', async () => {
        const topics = await opts.conv.listTopics();
        return topics.map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          color: t.color,
        }));
      });
    },

    mintDelegatedToken(_endUserId: string, _ttlSeconds?: number): Promise<DelegatedToken> {
      return Promise.reject(
        new Error(
          'mintDelegatedToken not implemented in in-process client; use HTTP MuninRestClient if you need delegated tokens',
        ),
      );
    },

    enqueueCuratorJob(_input: EnqueueCuratorJobInput): Promise<{ job: CuratorJob; alreadyPending: boolean }> {
      return Promise.reject(
        new Error(
          'enqueueCuratorJob not implemented in in-process client; the runner consumes jobs but does not enqueue them. Use HTTP MuninRestClient if you need this.',
        ),
      );
    },

    async claimCuratorJobs(input: ClaimCuratorJobsInput): Promise<CuratorJob[]> {
      return withTenancy(() =>
        opts.curator.claim({
          holder: input.holder,
          limit: input.limit,
          leaseSeconds: input.leaseSeconds,
        }),
      );
    },

    async ackCuratorJob(id: string, input: AckCuratorJobInput = {}): Promise<CuratorJob> {
      return audited('runner:ackCuratorJob', () => opts.curator.ack({ id, ...input }), {
        totalTokens: input.totalTokens,
      });
    },

    async failCuratorJob(id: string, input: FailCuratorJobInput): Promise<CuratorJob> {
      return audited('runner:failCuratorJob', () => opts.curator.fail({ id, ...input }));
    },

    async updateCuratorJobProgress(id: string, input: UpdateCuratorJobProgressInput): Promise<void> {
      await withTenancy(() =>
        opts.curator.updateProgress({ id, progress: input.progress as WebImportProgress }),
      );
    },

    toRuntimeHistory(detail: ConversationDetail): ConversationMessage[] {
      return detail.messages.map((m) => ({
        id: m.id,
        authorType: m.authorType,
        body: m.body,
        createdAt: m.createdAt,
        internal: m.internal,
      }));
    },
  };
}
