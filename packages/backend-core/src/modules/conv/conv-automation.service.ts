import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { AGENT_MODES, type AgentMode } from './agent-modes.ts';
import {
  AUTOMATION_MAX_REJECTED_RATE,
  AUTOMATION_MIN_SAMPLE,
  AUTOMATION_MIN_UNEDITED_RATE,
  AUTOMATION_WINDOW_DAYS,
  automationHold,
  ratePercent,
  type AutomationHold,
} from './agent-mode.ts';

export interface TopicAutomationRow {
  topicId: string;
  name: string;
  slug: string;
  agentMode: AgentMode | null;
  autoPromotedAt: string | null;
  windowDays: number;
  reviewed: number;
  autoSent: number;
  unedited: number;
  edited: number;
  rejected: number;
  uneditedPct: number;
  editedPct: number;
  rejectedPct: number;
  hold: AutomationHold;
  ready: boolean;
}

export interface TopicAutomationOverview {
  windowDays: number;
  minSample: number;
  minUneditedRate: number;
  maxRejectedRate: number;
  autoSendRatePct: number;
  reviewed: number;
  autoSent: number;
  topics: TopicAutomationRow[];
}

interface CountsRow {
  topicId: string;
  name: string;
  slug: string;
  agentMode: string | null;
  autoPromotedAt: Date | null;
  autoSent: number;
  unedited: number;
  edited: number;
  rejected: number;
}

@Injectable()
export class ConvAutomationService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  async listTopicAutomation(): Promise<TopicAutomationOverview> {
    const ctx = getCurrentContext();
    const since = new Date(Date.now() - AUTOMATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = (await ctx.db
      .select({
        topicId: schema.convTopics.id,
        name: schema.convTopics.name,
        slug: schema.convTopics.slug,
        agentMode: schema.convTopics.agentMode,
        autoPromotedAt: schema.convTopics.autoPromotedAt,
        unedited: sql<number>`COUNT(*) FILTER (
          WHERE ${schema.convMessages.metadata} -> 'approvedDraft' IS NOT NULL
            AND COALESCE((${schema.convMessages.metadata} -> 'approvedDraft' ->> 'edited')::boolean, false) = false
        )::int`,
        edited: sql<number>`COUNT(*) FILTER (
          WHERE ${schema.convMessages.metadata} -> 'approvedDraft' IS NOT NULL
            AND COALESCE((${schema.convMessages.metadata} -> 'approvedDraft' ->> 'edited')::boolean, false) = true
        )::int`,
        rejected: sql<number>`COUNT(*) FILTER (
          WHERE ${schema.convMessages.metadata} ->> 'kind' = 'draft_reply_rejected'
        )::int`,
        autoSent: sql<number>`COUNT(*) FILTER (
          WHERE ${schema.convMessages.internal} = false
            AND ${schema.convMessages.authorType} = 'agent'
            AND ${schema.convMessages.metadata} -> 'approvedDraft' IS NULL
        )::int`,
      })
      .from(schema.convTopics)
      .leftJoin(
        schema.convConversations,
        eq(schema.convConversations.topicId, schema.convTopics.id),
      )
      .leftJoin(
        schema.convMessages,
        sql`${schema.convMessages.conversationId} = ${schema.convConversations.id}
          AND ${schema.convMessages.createdAt} >= ${since}`,
      )
      .groupBy(
        schema.convTopics.id,
        schema.convTopics.name,
        schema.convTopics.slug,
        schema.convTopics.agentMode,
        schema.convTopics.autoPromotedAt,
      )
      .orderBy(schema.convTopics.name)) as CountsRow[];

    const topics = rows.map((row) => toAutomationRow(row));
    const reviewed = topics.reduce((sum, t) => sum + t.reviewed, 0);
    const autoSent = topics.reduce((sum, t) => sum + t.autoSent, 0);

    return {
      windowDays: AUTOMATION_WINDOW_DAYS,
      minSample: AUTOMATION_MIN_SAMPLE,
      minUneditedRate: AUTOMATION_MIN_UNEDITED_RATE,
      maxRejectedRate: AUTOMATION_MAX_REJECTED_RATE,
      autoSendRatePct: ratePercent(autoSent, autoSent + reviewed),
      reviewed,
      autoSent,
      topics,
    };
  }

  async setTopicAutomation(input: {
    topicId: string;
    mode: AgentMode | null;
  }): Promise<TopicAutomationRow> {
    if (input.mode !== null && !AGENT_MODES.includes(input.mode)) {
      throw new BadRequestException({
        message: `conv_invalid: agentMode must be null or one of ${AGENT_MODES.join(', ')}`,
        code: 'conv_invalid',
      });
    }
    const ctx = getCurrentContext();
    const [existing] = await ctx.db
      .select({ id: schema.convTopics.id })
      .from(schema.convTopics)
      .where(eq(schema.convTopics.id, input.topicId))
      .limit(1);
    if (!existing) {
      throw new NotFoundException({
        message: `conv_not_found: topic ${input.topicId}`,
        code: 'conv_not_found',
      });
    }

    await ctx.db
      .update(schema.convTopics)
      .set({
        agentMode: input.mode,
        autoPromotedAt: input.mode === 'auto' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.convTopics.id, input.topicId));

    await this.webhooks.emit({
      type: 'conversation.topic_automation_changed',
      payload: { topicId: input.topicId, agentMode: input.mode },
    });

    const overview = await this.listTopicAutomation();
    const row = overview.topics.find((t) => t.topicId === input.topicId);
    if (!row) {
      throw new NotFoundException({
        message: `conv_not_found: topic ${input.topicId}`,
        code: 'conv_not_found',
      });
    }
    return row;
  }
}

function toAutomationRow(row: CountsRow): TopicAutomationRow {
  const counts = {
    unedited: row.unedited,
    edited: row.edited,
    rejected: row.rejected,
  };
  const reviewed = counts.unedited + counts.edited + counts.rejected;
  const hold = automationHold(counts);
  const mode = row.agentMode as AgentMode | null;
  return {
    topicId: row.topicId,
    name: row.name,
    slug: row.slug,
    agentMode: mode,
    autoPromotedAt: row.autoPromotedAt ? row.autoPromotedAt.toISOString() : null,
    windowDays: AUTOMATION_WINDOW_DAYS,
    reviewed,
    autoSent: row.autoSent,
    ...counts,
    uneditedPct: ratePercent(counts.unedited, reviewed),
    editedPct: ratePercent(counts.edited, reviewed),
    rejectedPct: ratePercent(counts.rejected, reviewed),
    hold,
    ready: hold === null && mode !== 'auto',
  };
}
