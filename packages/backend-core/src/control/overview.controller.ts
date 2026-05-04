import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { CURATION_INBOX_SLUG } from '../modules/kb/kb.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

export interface OverviewBacklog {
  conversationsNeedingAttention: number;
  kbCurationPending: number;
  crmMergeProposalsPending: number;
}

export interface AgentStatus {
  selfServiceAgentSubscriberCount: number;
  lastInboundEndUserMessageAt: string | null;
  lastAgentMessageAt: string | null;
}

@Controller('api/overview')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OverviewController {
  constructor(@Inject(RealtimeGateway) private readonly realtime: RealtimeGateway) {}

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

  @Get('agent-status')
  async agentStatus(): Promise<AgentStatus> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const [lastInbound] = await ctx.db
      .select({ at: sql<Date | null>`max(${schema.convMessages.createdAt})` })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.authorType, 'end_user'));
    const [lastAgent] = await ctx.db
      .select({ at: sql<Date | null>`max(${schema.convMessages.createdAt})` })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.authorType, 'agent'));
    return {
      selfServiceAgentSubscriberCount: this.realtime.selfServiceSubscriberCount(orgId),
      lastInboundEndUserMessageAt: lastInbound?.at ? toIso(lastInbound.at) : null,
      lastAgentMessageAt: lastAgent?.at ? toIso(lastAgent.at) : null,
    };
  }
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
