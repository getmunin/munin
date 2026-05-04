import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { CURATION_INBOX_SLUG } from '../modules/kb/kb.service.js';

export interface OverviewBacklog {
  conversationsNeedingAttention: number;
  kbCurationPending: number;
  crmMergeProposalsPending: number;
}

@Controller('api/overview')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OverviewController {
  @Get('backlog')
  async backlog(): Promise<OverviewBacklog> {
    const ctx = getCurrentContext();
    const [convCountRow] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.needsHumanAttention, true));

    const [kbCountRow] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.kbDocuments)
      .innerJoin(schema.kbSpaces, eq(schema.kbSpaces.id, schema.kbDocuments.spaceId))
      .where(
        and(
          eq(schema.kbSpaces.slug, CURATION_INBOX_SLUG),
          sql`${schema.kbDocuments.tags} @> ${JSON.stringify(['candidate'])}::jsonb`,
        ),
      );

    const [crmMergeRow] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.crmMergeProposals)
      .where(eq(schema.crmMergeProposals.status, 'pending'));

    return {
      conversationsNeedingAttention: convCountRow?.n ?? 0,
      kbCurationPending: kbCountRow?.n ?? 0,
      crmMergeProposalsPending: crmMergeRow?.n ?? 0,
    };
  }
}
