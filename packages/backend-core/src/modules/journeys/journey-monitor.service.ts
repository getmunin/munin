import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { DEFAULT_JOURNEY_GUARDRAILS, JourneySpecSchema, type JourneySpec } from '@getmunin/types';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { JourneysService } from './journeys.service.ts';

export type GuardrailMetric = 'bounce' | 'unsubscribe' | 'failed_step';

export interface GuardrailThresholds {
  enabled: boolean;
  bounceRatePct: number;
  unsubscribeRatePct: number;
  failedStepRatePct: number;
  minVolume: number;
  windowDays: number;
}

export interface NodeGuardrailDto {
  nodeId: string;
  sends: number;
  bounces: number;
  unsubscribes: number;
  steps: number;
  failedSteps: number;
  bounceRatePct: number | null;
  unsubscribeRatePct: number | null;
  failedStepRatePct: number | null;
  breaches: GuardrailMetric[];
  paused: boolean;
}

export interface GuardrailReportDto {
  journeyId: string;
  thresholds: GuardrailThresholds;
  journey: Omit<NodeGuardrailDto, 'nodeId' | 'paused'>;
  nodes: NodeGuardrailDto[];
}

export interface GuardrailAction {
  journeyId: string;
  nodeId: string | null;
  metric: GuardrailMetric;
  ratePct: number;
}

type AlertOpener = Pick<AlertsService, 'openAlert'>;

@Injectable()
export class JourneyMonitorService {
  constructor(
    @Inject(JourneysService) private readonly journeys: JourneysService,
    @Inject(AlertsService) private readonly alerts: AlertOpener,
  ) {}

  async report(journeyId: string): Promise<GuardrailReportDto> {
    const journey = await this.journeys.get(journeyId);
    const parsed = JourneySpecSchema.safeParse((journey.live ?? journey.draft)?.spec);
    const thresholds = thresholdsOf(parsed.success ? parsed.data : null);
    const [state] = await getCurrentContext()
      .db.select({ resets: schema.journeys.guardrailResets })
      .from(schema.journeys)
      .where(eq(schema.journeys.id, journeyId))
      .limit(1);
    const rows = await this.nodeCounts(journeyId, journey.outreachCampaignId, thresholds.windowDays, state?.resets ?? {});
    const nodes = rows.map((r) => {
      const node = rate(r, thresholds);
      return { nodeId: r.node_id, ...node, paused: Boolean(journey.pausedNodes[r.node_id]) };
    });
    const total = nodes.reduce(
      (sum, n) => ({
        sends: sum.sends + n.sends,
        bounces: sum.bounces + n.bounces,
        unsubscribes: sum.unsubscribes + n.unsubscribes,
        steps: sum.steps + n.steps,
        failedSteps: sum.failedSteps + n.failedSteps,
      }),
      { sends: 0, bounces: 0, unsubscribes: 0, steps: 0, failedSteps: 0 },
    );
    return {
      journeyId,
      thresholds,
      journey: rate(
        {
          sends: total.sends,
          bounces: total.bounces,
          unsubscribes: total.unsubscribes,
          steps: total.steps,
          failed_steps: total.failedSteps,
        },
        thresholds,
      ),
      nodes,
    };
  }

  async enforce(): Promise<GuardrailAction[]> {
    const ctx = getCurrentContext();
    const live = await ctx.db
      .select({ id: schema.journeys.id, name: schema.journeys.name })
      .from(schema.journeys)
      .where(and(eq(schema.journeys.orgId, ctx.actor!.orgId), eq(schema.journeys.status, 'live')));
    const actions: GuardrailAction[] = [];
    for (const journey of live) {
      const report = await this.report(journey.id);
      if (!report.thresholds.enabled) continue;
      const breached = report.nodes.filter((n) => n.breaches.length > 0);
      for (const node of breached) {
        if (node.paused) continue;
        const metric = node.breaches[0]!;
        const ratePct = ratePctOf(node, metric);
        await this.journeys.pauseNode(journey.id, node.nodeId, { reason: 'guardrail', metric, rate: ratePct });
        await this.alert(journey, node.nodeId, metric, ratePct, report.thresholds);
        actions.push({ journeyId: journey.id, nodeId: node.nodeId, metric, ratePct });
      }
      const overall = report.journey.breaches[0];
      if (breached.length === 0 && overall) {
        const ratePct = ratePctOf(report.journey, overall);
        await this.journeys.pause(journey.id, { reason: 'guardrail', metric: overall, rate: ratePct });
        await this.alert(journey, null, overall, ratePct, report.thresholds);
        actions.push({ journeyId: journey.id, nodeId: null, metric: overall, ratePct });
      }
    }
    return actions;
  }

  private async alert(
    journey: { id: string; name: string },
    nodeId: string | null,
    metric: GuardrailMetric,
    ratePct: number,
    thresholds: GuardrailThresholds,
  ): Promise<void> {
    const limit = limitOf(thresholds, metric);
    const where = nodeId ? `step "${nodeId}" of journey "${journey.name}"` : `journey "${journey.name}"`;
    await this.alerts.openAlert({
      source: 'journeys',
      subjectId: journey.id,
      severity: 'error',
      title: `Paused ${where}: ${METRIC_LABEL[metric]} ${ratePct}% is above ${limit}%`,
      detail: `Over the last ${thresholds.windowDays} days. Nothing more is sent from it until someone resumes it.`,
      metadata: { journeyId: journey.id, nodeId, metric, ratePct, thresholdPct: limit },
      ctaHref: `/dashboard/journeys/${journey.id}`,
    });
  }

  private async nodeCounts(
    journeyId: string,
    campaignId: string | null,
    windowDays: number,
    resets: Record<string, string>,
  ): Promise<CountRow[]> {
    const resetJson = JSON.stringify(resets);
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const result = await ctx.db.execute(sql`
      WITH sent AS (
        SELECT p.contact_id,
               p.conversation_id,
               lower(btrim(c.email)) AS email,
               p.sent_at,
               s.node_id,
               lead(p.sent_at) OVER (PARTITION BY p.contact_id ORDER BY p.sent_at) AS next_sent_at
          FROM outreach_proposals p
          LEFT JOIN crm_contacts c ON c.id = p.contact_id
          JOIN journey_step_runs s ON s.id = p.journey_step_run_id
          JOIN journey_enrollments en ON en.id = s.enrollment_id
         WHERE en.journey_id = ${journeyId}
           AND p.status = 'sent'
           AND p.sent_at > now() - make_interval(days => ${windowDays})
           AND p.sent_at > coalesce((${resetJson}::jsonb->>s.node_id)::timestamptz, (${resetJson}::jsonb->>'*')::timestamptz, '-infinity')
      ),
      sends AS (
        SELECT node_id,
               count(*)::int AS sends,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM events ev
                  WHERE ev.org_id = ${orgId}
                    AND ev.type = 'conversation.message.bounced'
                    AND (ev.payload->>'conversationId' = sent.conversation_id OR ev.payload->>'address' = sent.email)
                    AND ev.created_at >= sent.sent_at
                    AND (sent.next_sent_at IS NULL OR ev.created_at < sent.next_sent_at)
               ))::int AS bounces,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM events ev
                  WHERE ev.org_id = ${orgId}
                    AND ev.type = 'crm.contact.unsubscribed'
                    AND ev.payload->>'contactId' = sent.contact_id
                    AND (ev.payload->>'journeyId' = ${journeyId} OR ev.payload->>'campaignId' = ${campaignId ?? ''})
                    AND ev.created_at >= sent.sent_at
                    AND (sent.next_sent_at IS NULL OR ev.created_at < sent.next_sent_at)
               ))::int AS unsubscribes
          FROM sent
         GROUP BY node_id
      ),
      steps AS (
        SELECT s.node_id,
               count(*)::int AS steps,
               count(*) FILTER (WHERE s.reason IN ('action_failed', 'message_failed', 'step_failed'))::int AS failed_steps
          FROM journey_step_runs s
          JOIN journey_enrollments en ON en.id = s.enrollment_id
         WHERE en.journey_id = ${journeyId}
           AND s.finished_at > now() - make_interval(days => ${windowDays})
           AND s.finished_at > coalesce((${resetJson}::jsonb->>s.node_id)::timestamptz, (${resetJson}::jsonb->>'*')::timestamptz, '-infinity')
         GROUP BY s.node_id
      )
      SELECT coalesce(sends.node_id, steps.node_id) AS node_id,
             coalesce(sends.sends, 0) AS sends,
             coalesce(sends.bounces, 0) AS bounces,
             coalesce(sends.unsubscribes, 0) AS unsubscribes,
             coalesce(steps.steps, 0) AS steps,
             coalesce(steps.failed_steps, 0) AS failed_steps
        FROM sends
        FULL OUTER JOIN steps ON steps.node_id = sends.node_id
       ORDER BY 1
    `);
    return rowsOf(result) as CountRow[];
  }
}

interface CountRow {
  node_id: string;
  sends: number;
  bounces: number;
  unsubscribes: number;
  steps: number;
  failed_steps: number;
}

const METRIC_LABEL: Record<GuardrailMetric, string> = {
  bounce: 'bounce rate',
  unsubscribe: 'unsubscribe rate',
  failed_step: 'failed-step rate',
};

export function thresholdsOf(spec: JourneySpec | null): GuardrailThresholds {
  return { ...DEFAULT_JOURNEY_GUARDRAILS, ...(spec?.settings.guardrails ?? {}) };
}

function rate(row: Omit<CountRow, 'node_id'>, t: GuardrailThresholds): Omit<NodeGuardrailDto, 'nodeId' | 'paused'> {
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
  const bounceRatePct = pct(row.bounces, row.sends);
  const unsubscribeRatePct = pct(row.unsubscribes, row.sends);
  const failedStepRatePct = pct(row.failed_steps, row.steps);
  const breaches: GuardrailMetric[] = [];
  if (row.sends >= t.minVolume && (bounceRatePct ?? 0) > t.bounceRatePct) breaches.push('bounce');
  if (row.sends >= t.minVolume && (unsubscribeRatePct ?? 0) > t.unsubscribeRatePct) breaches.push('unsubscribe');
  if (row.steps >= t.minVolume && (failedStepRatePct ?? 0) > t.failedStepRatePct) breaches.push('failed_step');
  return {
    sends: row.sends,
    bounces: row.bounces,
    unsubscribes: row.unsubscribes,
    steps: row.steps,
    failedSteps: row.failed_steps,
    bounceRatePct,
    unsubscribeRatePct,
    failedStepRatePct,
    breaches,
  };
}

function ratePctOf(row: Omit<NodeGuardrailDto, 'nodeId' | 'paused'>, metric: GuardrailMetric): number {
  if (metric === 'bounce') return row.bounceRatePct ?? 0;
  if (metric === 'unsubscribe') return row.unsubscribeRatePct ?? 0;
  return row.failedStepRatePct ?? 0;
}

function limitOf(t: GuardrailThresholds, metric: GuardrailMetric): number {
  if (metric === 'bounce') return t.bounceRatePct;
  if (metric === 'unsubscribe') return t.unsubscribeRatePct;
  return t.failedStepRatePct;
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? rows : [];
}
