import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import {
  ConvService,
  type ConversationSummary,
} from '../modules/conv/conv.service.js';
import {
  ConversationClaimsService,
  type ConversationClaim,
} from '../modules/conv/conv.claims.service.js';
import {
  KbService,
  type CurationCandidateSummary,
} from '../modules/kb/kb.service.js';
import { CrmService, type MergeProposalDto } from '../modules/crm/crm.service.js';
import { OutreachService, type ProposalDto } from '../modules/outreach/outreach.service.js';

interface LiveConversation extends ConversationSummary {
  latestEndUserMessage: { body: string; createdAt: string } | null;
  claim: ConversationClaim | null;
}

interface InboxQueueResponse {
  live: LiveConversation[];
  queue: {
    kb: CurationCandidateSummary[];
    crm: MergeProposalDto[];
    outreach: ProposalDto[];
  };
}

@Controller('api/inbox')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class InboxController {
  constructor(
    private readonly conv: ConvService,
    private readonly claims: ConversationClaimsService,
    private readonly kb: KbService,
    private readonly crm: CrmService,
    private readonly outreach: OutreachService,
  ) {}

  @Get('queue')
  async queue(): Promise<InboxQueueResponse> {
    const [live, kbItems, crmItems, outreachItems] = await Promise.all([
      this.loadLive(),
      this.kb.listCurationCandidates(50),
      this.crm.listMergeProposals({ status: 'pending', limit: 50 }),
      this.outreach.listProposals({ status: 'pending', limit: 50 }),
    ]);

    return {
      live,
      queue: { kb: kbItems, crm: crmItems, outreach: outreachItems },
    };
  }

  private async loadLive(): Promise<LiveConversation[]> {
    const summaries = await this.conv.listConversations({
      needsHumanAttention: true,
      limit: 50,
    });
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
