import {
  Controller,
  Get,
  Inject,
  Optional,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
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
import { OutreachService, type ProposalDto } from '../modules/outreach/outreach.service.ts';
import { FeedbackService } from '../modules/feedback/feedback.service.ts';
import type { FeedbackOutboxDto } from '../modules/feedback/feedback.service.ts';

interface LiveConversation extends ConversationSummary {
  latestEndUserMessage: { body: string; createdAt: string } | null;
  claim: ConversationClaim | null;
}

const EXCLUDED_LIVE_STATUSES = ['closed', 'spam'] as const;

interface InboxQueueResponse {
  live: LiveConversation[];
  queue: {
    kb: CurationCandidateSummary[];
    crm: MergeProposalDto[];
    outreach: ProposalDto[];
    feedback?: FeedbackOutboxDto[];
  };
}

@Controller('v1/inbox')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class InboxController {
  constructor(
    private readonly conv: ConvService,
    private readonly claims: ConversationClaimsService,
    private readonly kb: KbService,
    private readonly crm: CrmService,
    private readonly outreach: OutreachService,
    @Optional() @Inject(FeedbackService) private readonly feedback: FeedbackService | null = null,
  ) {}

  @Get()
  async queue(): Promise<InboxQueueResponse> {
    const [live, kbItems, crmItems, outreachItems, feedbackItems] = await Promise.all([
      this.loadLive(),
      this.kb.listCurationCandidates(50),
      this.crm.listMergeProposals({ status: 'pending', limit: 50 }),
      this.outreach.listProposals({ status: 'pending', limit: 50 }),
      this.feedback ? this.feedback.listPending() : Promise.resolve(undefined),
    ]);

    return {
      live,
      queue: {
        kb: kbItems,
        crm: crmItems,
        outreach: outreachItems,
        ...(feedbackItems ? { feedback: feedbackItems } : {}),
      },
    };
  }

  private async loadLive(): Promise<LiveConversation[]> {
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
    const claimedIds = new Set(claimedIdRows.map((r) => r.id));

    const flaggedSummaries = await this.conv.listConversations({
      needsHumanAttention: true,
      excludeStatuses: EXCLUDED_LIVE_STATUSES,
      limit: 50,
    });
    const flaggedIds = new Set(flaggedSummaries.map((c) => c.id));
    const missingClaimedIds = [...claimedIds].filter((id) => !flaggedIds.has(id));
    const claimedOnly =
      missingClaimedIds.length > 0
        ? await this.conv.listConversationsByIds(missingClaimedIds, {
            excludeStatuses: EXCLUDED_LIVE_STATUSES,
          })
        : [];
    const summaries = [...flaggedSummaries, ...claimedOnly];
    if (summaries.length === 0) return [];

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

    return summaries.map((s) => ({
      ...s,
      latestEndUserMessage: latestByConv.get(s.id) ?? null,
      claim: claimsByConv.get(s.id) ?? null,
    }));
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
