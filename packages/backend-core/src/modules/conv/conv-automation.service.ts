import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { asc, eq, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { type AgentMode } from './conv.service.ts';

const STATS_WINDOW_DAYS = 30;
const AUTO_RATE_WINDOW_DAYS = 7;

export interface TopicAutomationRow {
  id: string;
  name: string;
  slug: string;
  agentMode: AgentMode | null;
  autoPromotedAt: string | null;
  windowDays: number;
  weeklyVolume: number;
  reviewedCount: number;
  approvedUnedited: number;
  edited: number;
  rejected: number;
  autoSent: number;
}

export interface TopicAutomationSummary {
  windowDays: number;
  autoRate7d: number | null;
  topics: TopicAutomationRow[];
}

interface RateRow extends Record<string, unknown> {
  auto_sent: number;
  outbound: number;
}

interface TopicStatsRow extends Record<string, unknown> {
  topic_id: string;
  outbound: number;
  auto_sent: number;
  approved_unedited: number;
  edited: number;
  rejected: number;
}

@Injectable()
export class ConvAutomationService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  async listTopicAutomation(): Promise<TopicAutomationSummary> {
    const ctx = getCurrentContext();
    const topics = await ctx.db
      .select()
      .from(schema.convTopics)
      .orderBy(asc(schema.convTopics.name));

    const stats = await ctx.db.execute<TopicStatsRow>(sql`
      SELECT c.topic_id,
        COUNT(*) FILTER (
          WHERE m.internal = false AND m.author_type IN ('agent', 'user')
        )::int AS outbound,
        COUNT(*) FILTER (
          WHERE m.internal = false AND m.author_type = 'agent'
        )::int AS auto_sent,
        COUNT(*) FILTER (
          WHERE m.internal = false AND m.author_type = 'user'
            AND m.metadata -> 'approvedDraft' ->> 'edited' = 'false'
        )::int AS approved_unedited,
        COUNT(*) FILTER (
          WHERE m.internal = false AND m.author_type = 'user'
            AND m.metadata -> 'approvedDraft' ->> 'edited' = 'true'
        )::int AS edited,
        COUNT(*) FILTER (
          WHERE m.internal = true AND m.metadata ->> 'kind' = 'draft_reply_rejected'
        )::int AS rejected
      FROM conv_messages m
      JOIN conv_conversations c ON c.id = m.conversation_id
      WHERE c.topic_id IS NOT NULL
        AND m.created_at > now() - make_interval(days => ${STATS_WINDOW_DAYS})
      GROUP BY c.topic_id
    `);
    const statsByTopic = new Map(stats.map((row) => [row.topic_id, row]));

    const [rate] = await ctx.db.execute<RateRow>(sql`
      SELECT
        COUNT(*) FILTER (WHERE m.author_type = 'agent')::int AS auto_sent,
        COUNT(*)::int AS outbound
      FROM conv_messages m
      WHERE m.internal = false
        AND m.author_type IN ('agent', 'user')
        AND m.created_at > now() - make_interval(days => ${AUTO_RATE_WINDOW_DAYS})
    `);

    return {
      windowDays: STATS_WINDOW_DAYS,
      autoRate7d:
        rate && rate.outbound > 0
          ? Math.round((rate.auto_sent / rate.outbound) * 100) / 100
          : null,
      topics: topics.map((topic) => {
        const s = statsByTopic.get(topic.id);
        const reviewed = (s?.approved_unedited ?? 0) + (s?.edited ?? 0) + (s?.rejected ?? 0);
        return {
          id: topic.id,
          name: topic.name,
          slug: topic.slug,
          agentMode: (topic.agentMode as AgentMode | null) ?? null,
          autoPromotedAt: topic.autoPromotedAt?.toISOString() ?? null,
          windowDays: STATS_WINDOW_DAYS,
          weeklyVolume: Math.round(((s?.outbound ?? 0) / STATS_WINDOW_DAYS) * 7),
          reviewedCount: reviewed,
          approvedUnedited: s?.approved_unedited ?? 0,
          edited: s?.edited ?? 0,
          rejected: s?.rejected ?? 0,
          autoSent: s?.auto_sent ?? 0,
        };
      }),
    };
  }

  async setTopicAgentMode(input: {
    topicId: string;
    mode: AgentMode | null;
  }): Promise<{ id: string; slug: string; agentMode: AgentMode | null; autoPromotedAt: string | null }> {
    const ctx = getCurrentContext();
    const [existing] = await ctx.db
      .select({
        id: schema.convTopics.id,
        slug: schema.convTopics.slug,
        agentMode: schema.convTopics.agentMode,
        autoPromotedAt: schema.convTopics.autoPromotedAt,
      })
      .from(schema.convTopics)
      .where(eq(schema.convTopics.id, input.topicId))
      .limit(1);
    if (!existing) {
      throw new NotFoundException(`conv_not_found: topic ${input.topicId}`);
    }

    const autoPromotedAt =
      input.mode === 'auto'
        ? existing.agentMode === 'auto'
          ? existing.autoPromotedAt
          : new Date()
        : null;
    const [updated] = await ctx.db
      .update(schema.convTopics)
      .set({ agentMode: input.mode, autoPromotedAt, updatedAt: new Date() })
      .where(eq(schema.convTopics.id, input.topicId))
      .returning({
        id: schema.convTopics.id,
        slug: schema.convTopics.slug,
        agentMode: schema.convTopics.agentMode,
        autoPromotedAt: schema.convTopics.autoPromotedAt,
      });

    await this.webhooks.emit({
      type: 'conversation.topic_automation_changed',
      payload: {
        topicId: existing.id,
        topicSlug: existing.slug,
        mode: input.mode,
        previousMode: (existing.agentMode) ?? null,
      },
    });

    return {
      id: updated!.id,
      slug: updated!.slug,
      agentMode: (updated!.agentMode as AgentMode | null) ?? null,
      autoPromotedAt: updated!.autoPromotedAt?.toISOString() ?? null,
    };
  }
}
