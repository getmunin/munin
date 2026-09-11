import {
  Controller,
  Get,
  Inject,
  Optional,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, gt, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  ConvService,
  type ConversationSummary,
} from '../modules/conv/conv.service.ts';
import {
  ConversationClaimsService,
  type ConversationClaim,
} from '../modules/conv/conv.claims.service.ts';
import {
  KbService,
  type CurationCandidateSummary,
} from '../modules/kb/kb.service.ts';
import { CrmService, type MergeProposalDto } from '../modules/crm/crm.service.ts';
import {
  OutreachService,
  type ProposalSummaryDto,
} from '../modules/outreach/outreach.service.ts';
import { FeedbackService } from '../modules/feedback/feedback.service.ts';
import type { FeedbackOutboxDto } from '../modules/feedback/feedback.service.ts';
import {
  CmsService,
  type CmsDraftEntrySummary,
  type CmsScheduledEntrySummary,
} from '../modules/cms/cms.service.ts';

interface LiveConversation extends ConversationSummary {
  latestEndUserMessage: { body: string; createdAt: string } | null;
  claim: ConversationClaim | null;
}

const EXCLUDED_LIVE_STATUSES = ['closed', 'spam'] as const;
const LIVE_LIST_LIMIT = 50;

interface InboxQueueResponse {
  live: LiveConversation[];
  liveTotal: number;
  queue: {
    kb: CurationCandidateSummary[];
    crm: MergeProposalDto[];
    outreach: ProposalSummaryDto[];
    outreachScheduled: ProposalSummaryDto[];
    cms: CmsDraftEntrySummary[];
    cmsScheduled: CmsScheduledEntrySummary[];
    feedback?: FeedbackOutboxDto[];
  };
}

@Controller('v1/inbox')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class InboxController {
  constructor(
    private readonly conv: ConvService,
    private readonly claims: ConversationClaimsService,
    private readonly kb: KbService,
    private readonly crm: CrmService,
    private readonly outreach: OutreachService,
    private readonly cms: CmsService,
    @Optional() @Inject(FeedbackService) private readonly feedback: FeedbackService | null = null,
  ) {}

  @Get()
  async queue(): Promise<InboxQueueResponse> {
    const [
      liveResult,
      kbItems,
      crmItems,
      outreachItems,
      outreachScheduled,
      cmsItems,
      cmsScheduled,
      feedbackItems,
    ] = await Promise.all([
      this.loadLive(),
      this.kb.listCurationCandidates(50),
      this.crm.listMergeProposals({ status: 'pending', limit: 50 }),
      this.outreach.listProposals({ status: 'pending', limit: 50 }),
      this.outreach.listProposals({ status: 'approved', limit: 50 }),
      this.cms.listDraftEntries(50),
      this.cms.listScheduledEntries(50),
      this.feedback ? this.feedback.listPending() : Promise.resolve(undefined),
    ]);

    return {
      live: liveResult.live,
      liveTotal: liveResult.total,
      queue: {
        kb: kbItems,
        crm: crmItems,
        outreach: outreachItems,
        outreachScheduled,
        cms: cmsItems,
        cmsScheduled,
        ...(feedbackItems ? { feedback: feedbackItems } : {}),
      },
    };
  }

  private async loadLive(): Promise<{ live: LiveConversation[]; total: number }> {
    const ctx = getCurrentContext();
    const claimedIdRows = await ctx.db
      .select({ id: schema.claims.entityId })
      .from(schema.claims)
      .where(
        and(
          eq(schema.claims.entityType, 'conversation'),
          isNotNull(schema.claims.userId),
          gt(schema.claims.expiresAt, sql`now()`),
        ),
      );
    const claimedIds = [...new Set(claimedIdRows.map((r) => r.id))];

    const [flaggedSummaries, flaggedTotal, claimedOnly] = await Promise.all([
      this.conv.listConversations({
        needsHumanAttention: true,
        excludeStatuses: EXCLUDED_LIVE_STATUSES,
        limit: LIVE_LIST_LIMIT,
      }),
      this.conv.countConversations({
        needsHumanAttention: true,
        excludeStatuses: EXCLUDED_LIVE_STATUSES,
      }),
      this.conv.listConversationsByIds(claimedIds, {
        excludeStatuses: EXCLUDED_LIVE_STATUSES,
        needsHumanAttention: false,
      }),
    ]);

    const summaries = [...flaggedSummaries, ...claimedOnly];
    const total = flaggedTotal + claimedOnly.length;
    if (summaries.length === 0) return { live: [], total };

    const ids = summaries.map((c) => c.id);

    const [latestByConv, claimsByConv] = await Promise.all([
      this.loadLatestEndUserMessages(ids),
      Promise.all(ids.map((id) => this.claims.getActiveClaim(id))).then((rows) => {
        const map = new Map<string, ConversationClaim>();
        rows.forEach((c, i) => {
          if (c) map.set(ids[i]!, c);
        });
        return map;
      }),
    ]);

    return {
      live: summaries.map((s) => ({
        ...s,
        latestEndUserMessage: latestByConv.get(s.id) ?? null,
        claim: claimsByConv.get(s.id) ?? null,
      })),
      total,
    };
  }

  private async loadLatestEndUserMessages(
    conversationIds: string[],
  ): Promise<Map<string, { body: string; createdAt: string }>> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        conversationId: schema.convMessages.conversationId,
        body: schema.convMessages.body,
        createdAt: schema.convMessages.createdAt,
      })
      .from(schema.convMessages)
      .where(
        and(
          inArray(schema.convMessages.conversationId, conversationIds),
          eq(schema.convMessages.authorType, 'end_user'),
          eq(schema.convMessages.internal, false),
          ne(schema.convMessages.body, ''),
        ),
      )
      .orderBy(
        schema.convMessages.conversationId,
        desc(schema.convMessages.createdAt),
      );

    const out = new Map<string, { body: string; createdAt: string }>();
    for (const r of rows) {
      if (!out.has(r.conversationId)) {
        out.set(r.conversationId, {
          body: r.body,
          createdAt: r.createdAt.toISOString(),
        });
      }
    }
    return out;
  }
}
