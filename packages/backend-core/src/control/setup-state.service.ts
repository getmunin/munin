import { Inject, Injectable, Optional } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, isNotNull, ne, notInArray, notLike, or, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  AGENT_HOST_ACTOR,
  AGENT_HOST_ACTOR_PREFIX,
  SYSTEM_ACTOR_IDS,
} from '@getmunin/types';
import {
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
  getCurrentContext,
} from '@getmunin/core';
import { ConvService, type ChannelDto } from '../modules/conv/conv.service.ts';
import { CURATION_INBOX_SLUG, KbService } from '../modules/kb/kb.service.ts';
import { CrmService } from '../modules/crm/crm.service.ts';
import { OutreachService } from '../modules/outreach/outreach.service.ts';
import { CmsService } from '../modules/cms/cms.service.ts';
import { FeedbackService } from '../modules/feedback/feedback.service.ts';
import { toIsoString } from '../common/iso.ts';

const RESERVED_KB_SPACE_SLUGS = [
  CURATION_INBOX_SLUG,
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
];

export interface SetupReviewQueueDto {
  hasPendingItems: boolean;
  lastDecisionAt: string | null;
}

export interface SetupStateDto {
  channels: ChannelDto[];
  conversationCount: number;
  topicCount: number;
  knowledgeDocumentCount: number;
  externalMcpCallCount: number;
  lastExternalMcpCallAt: string | null;
  reviewQueue: SetupReviewQueueDto | null;
}

const REVIEW_QUEUE_SCAN_LIMIT = 50;

@Injectable()
export class SetupStateService {
  constructor(
    @Inject(ConvService) private readonly conv: ConvService,
    @Inject(KbService) private readonly kb: KbService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(OutreachService) private readonly outreach: OutreachService,
    @Inject(CmsService) private readonly cms: CmsService,
    @Optional() @Inject(FeedbackService) private readonly feedback: FeedbackService | null = null,
  ) {}

  async read(): Promise<SetupStateDto> {
    const [channels, conversationCount, topicCount, knowledgeDocumentCount, mcp] =
      await Promise.all([
        this.conv.listChannels(),
        countRows(schema.convConversations),
        countRows(schema.convTopics),
        this.countKnowledgeDocuments(),
        this.readExternalMcpActivity(),
      ]);

    return {
      channels,
      conversationCount,
      topicCount,
      knowledgeDocumentCount,
      externalMcpCallCount: mcp.count,
      lastExternalMcpCallAt: mcp.lastAt,
      reviewQueue: conversationCount === 0 ? await this.readReviewQueue() : null,
    };
  }

  private async readReviewQueue(): Promise<SetupReviewQueueDto> {
    const limit = REVIEW_QUEUE_SCAN_LIMIT;
    const [
      candidates,
      merges,
      proposals,
      approvedProposals,
      drafts,
      scheduledEntries,
      feedbackItems,
      decisions,
    ] = await Promise.all([
      this.kb.listCurationCandidates(limit),
      this.crm.listMergeProposals({ status: 'pending', limit }),
      this.outreach.listProposals({ status: 'pending', limit }),
      this.outreach.listProposals({ status: 'approved', limit }),
      this.cms.listDraftEntries(limit),
      this.cms.listScheduledEntries(limit),
      this.feedback ? this.feedback.listPending() : Promise.resolve([]),
      this.kb.listCurationDecisions({ limit: 1 }),
    ]);

    return {
      hasPendingItems:
        candidates.length > 0 ||
        merges.length > 0 ||
        proposals.length > 0 ||
        approvedProposals.some((proposal) => proposal.scheduledSendAt !== null) ||
        drafts.length > 0 ||
        scheduledEntries.length > 0 ||
        feedbackItems.length > 0,
      lastDecisionAt: decisions[0]?.decidedAt ?? null,
    };
  }

  private async countKnowledgeDocuments(): Promise<number> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.kbDocuments)
      .innerJoin(schema.kbSpaces, eq(schema.kbSpaces.id, schema.kbDocuments.spaceId))
      .where(
        and(
          notInArray(schema.kbSpaces.slug, RESERVED_KB_SPACE_SLUGS),
          eq(schema.kbDocuments.isSystem, false),
        ),
      );
    return row?.n ?? 0;
  }

  private async readExternalMcpActivity(): Promise<{ count: number; lastAt: string | null }> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({
        n: sql<number>`count(*)::int`,
        lastAt: sql<Date | string | null>`max(${schema.auditLog.createdAt})`,
      })
      .from(schema.auditLog)
      .where(
        and(
          isNotNull(schema.auditLog.tool),
          ne(schema.auditLog.actorType, 'system'),
          or(
            isNotNull(schema.auditLog.clientId),
            and(
              isNotNull(schema.auditLog.actorId),
              ne(schema.auditLog.actorId, AGENT_HOST_ACTOR),
              notLike(schema.auditLog.actorId, `${AGENT_HOST_ACTOR_PREFIX}%`),
              notInArray(schema.auditLog.actorId, [...SYSTEM_ACTOR_IDS]),
            ),
          ),
        ),
      );
    return { count: row?.n ?? 0, lastAt: toIsoString(row?.lastAt ?? null) };
  }
}

async function countRows(table: PgTable): Promise<number> {
  const ctx = getCurrentContext();
  const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}
