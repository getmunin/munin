import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { schema } from '@getmunin/db';
import { and, count, eq, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { JourneySpecSchema, tierFor, type JourneyNode, type JourneySpec } from '@getmunin/types';
import { JourneysService, hashSpec } from './journeys.service.ts';
import { DECIDE_STEP_JOB_URI, DRAFT_STEP_JOB_URI, ENRICH_STEP_JOB_URI, nextScheduledEntry } from './journey-runtime.service.ts';
import { JourneySimulator, type SimulationResult } from './journey-simulator.ts';
import { emailTemplateHash } from '../outreach/email-template-hash.ts';
import type { JourneyValidation } from './journey-validator.ts';

export interface JourneyDiff {
  againstVersion: number | null;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  changedBlocks: string[];
  autoNodes: string[];
}

export const AUTO_PROMOTION_MIN_REVIEWED = 30;
export const AUTO_PROMOTION_MIN_UNEDITED_RATE = 0.9;
export const REVIEW_STATS_WINDOW_DAYS = 30;
export const DEFAULT_TOKENS_PER_AGENT_RUN: Record<AgentStepKind, number> = { decide: 2500, enrich: 2500, draft: 7000 };
export const ASSUMED_USD_PER_MILLION_TOKENS = { fast: 1, smart: 5 } as const;

export type AgentStepKind = 'decide' | 'enrich' | 'draft';

export const SPLIT_MIN_PER_PATH = 30;
export const SPLIT_SIGNIFICANCE = 0.05;

export interface SplitPathResultDto {
  path: string;
  entered: number;
  converted: number;
  rate: number | null;
  liftVsControl: number | null;
  pValue: number | null;
}

export interface SplitResultDto {
  nodeId: string;
  version: number;
  control: string | null;
  sampleSize: number | null;
  sampleFull: boolean;
  paths: SplitPathResultDto[];
  winner: string | null;
}

export interface ChangeProposalDto {
  version: number;
  diff: JourneyDiff;
  validation: JourneyValidation;
  simulation: { entered: number; exits: Record<string, number>; edges: Record<string, number>; estimatedAgentUsd: number } | null;
}

export interface AgentNodeStatsDto {
  nodeId: string;
  kind: AgentStepKind;
  tier: 'fast' | 'smart';
  runs: number;
  fallbacks: number;
  fallbackRate: number | null;
  totalTokens: number;
  avgTokens: number | null;
  edges: Record<string, number>;
  daily: { day: string; runs: number; fallbacks: number; edges: Record<string, number> }[];
  review: { reviewed: number; editRate: number | null; rejectionRate: number | null } | null;
}

export interface AgentCostEstimate {
  runs: number;
  estimatedTokens: number;
  estimatedUsd: number;
  assumedUsdPerMillionTokens: typeof ASSUMED_USD_PER_MILLION_TOKENS;
  byNode: {
    nodeId: string;
    kind: AgentStepKind;
    tier: 'fast' | 'smart';
    runs: number;
    tokensPerRun: number;
    basis: 'history' | 'default';
  }[];
}

export interface NodeReviewStatsDto {
  nodeId: string;
  approvedUnedited: number;
  edited: number;
  dismissed: number;
  pending: number;
  sentWithoutReview: number;
  reviewed: number;
  uneditedRate: number | null;
  readyForAuto: boolean;
}

export interface PublishRequestDto {
  journeyId: string;
  version: number;
  fingerprint: string;
  diff: JourneyDiff;
  validation: JourneyValidation;
  simulation: SimulationResult;
  reviewStats: NodeReviewStatsDto[];
  autoMessages: { nodeId: string; channel: string; class: string; subject: string | null; preview: string; draftBy: string | null }[];
  reviewPath: string;
}

export interface JourneyReportDto {
  journeyId: string;
  version: number | null;
  enrollments: { total: number; byState: Record<string, number>; exitReasons: Record<string, number> };
  goal: {
    treated: { entered: number; converted: number; rate: number | null };
    holdout: { entered: number; converted: number; rate: number | null };
    lift: number | null;
  };
  nodes: { nodeId: string; nodeType: string; arrived: number; waitingNow: number; failed: number; edges: Record<string, number> }[];
  messages: Record<string, Record<string, number>>;
  integrity: { duplicateSends: number; enrollmentsWithoutTrace: number };
}

@Injectable()
export class JourneyPublishingService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(JourneysService) private readonly journeys: JourneysService,
    @Inject(JourneySimulator) private readonly simulator: JourneySimulator,
  ) {}

  async simulate(input: {
    journeyId: string;
    version?: number;
    contactIds?: string[];
    segmentId?: string;
    limit?: number;
    renderSamples?: number;
  }): Promise<SimulationResult & { version: number; agentCost: AgentCostEstimate }> {
    const { version, spec } = await this.parsedVersion(input.journeyId, input.version);
    const result = await this.simulator.simulate({ ...input, spec });
    const history = new Map((await this.agentStats(input.journeyId)).map((s) => [s.nodeId, s]));
    const byNode: AgentCostEstimate['byNode'] = [];
    for (const node of spec.nodes) {
      const kind = agentKindOf(node);
      if (!kind) continue;
      const runs = result.arrivals[node.id] ?? 0;
      const past = history.get(node.id);
      const fromHistory = past?.avgTokens ?? null;
      byNode.push({
        nodeId: node.id,
        kind,
        tier: tierFor(AGENT_JOB_URI[kind]),
        runs,
        tokensPerRun: fromHistory ?? DEFAULT_TOKENS_PER_AGENT_RUN[kind],
        basis: fromHistory === null ? 'default' : 'history',
      });
    }
    const estimatedTokens = byNode.reduce((sum, n) => sum + n.runs * n.tokensPerRun, 0);
    const estimatedUsd = byNode.reduce(
      (sum, n) => sum + (n.runs * n.tokensPerRun * ASSUMED_USD_PER_MILLION_TOKENS[n.tier]) / 1_000_000,
      0,
    );
    return {
      version,
      ...result,
      agentCost: {
        runs: byNode.reduce((sum, n) => sum + n.runs, 0),
        estimatedTokens,
        estimatedUsd: Math.round(estimatedUsd * 10_000) / 10_000,
        assumedUsdPerMillionTokens: ASSUMED_USD_PER_MILLION_TOKENS,
        byNode,
      },
    };
  }

  async agentStats(journeyId: string, days = REVIEW_STATS_WINDOW_DAYS): Promise<AgentNodeStatsDto[]> {
    const ctx = getCurrentContext();
    const journey = await this.journeys.get(journeyId);
    const spec = JourneySpecSchema.safeParse((journey.live ?? journey.draft)?.spec);
    const kinds = new Map<string, AgentStepKind>();
    for (const node of spec.success ? spec.data.nodes : []) {
      const kind = agentKindOf(node);
      if (kind) kinds.set(node.id, kind);
    }
    const rows = rowsOf(
      await ctx.db.execute(sql`
        SELECT s.node_id,
               s.node_type,
               to_char(date_trunc('day', s.started_at), 'YYYY-MM-DD') AS day,
               s.edge_taken,
               CASE
                 WHEN s.node_type = 'message' THEN NOT (s.output ? 'draft')
                 WHEN s.output ? 'decision' THEN coalesce((s.output->'decision'->>'fallback')::boolean, false)
                 ELSE NOT (s.output ? 'fields')
               END AS fallback,
               coalesce(cj.last_total_tokens, 0)::int AS tokens
          FROM journey_step_runs s
          JOIN journey_enrollments en ON en.id = s.enrollment_id
          LEFT JOIN curator_jobs cj ON cj.id = s.output->>'curatorJobId'
         WHERE en.journey_id = ${journeyId}
           AND s.started_at > now() - make_interval(days => ${days})
           AND (
             (s.node_type = 'agent' AND s.finished_at IS NOT NULL)
             OR (s.node_type = 'message' AND s.output ? 'draftRequested' AND s.output ? 'proposalId')
           )
         ORDER BY day
      `),
    ) as { node_id: string; node_type: string; day: string; edge_taken: string | null; fallback: boolean; tokens: number }[];

    const review = new Map((await this.nodeReviewStats(journeyId)).map((r) => [r.nodeId, r]));
    const stats = new Map<string, AgentNodeStatsDto>();
    for (const row of rows) {
      const kind = kinds.get(row.node_id) ?? (row.node_type === 'message' ? 'draft' : 'decide');
      let entry = stats.get(row.node_id);
      if (!entry) {
        const reviewed = review.get(row.node_id);
        entry = {
          nodeId: row.node_id,
          kind,
          tier: tierFor(AGENT_JOB_URI[kind]),
          runs: 0,
          fallbacks: 0,
          fallbackRate: null,
          totalTokens: 0,
          avgTokens: null,
          edges: {},
          daily: [],
          review:
            kind === 'draft' && reviewed
              ? {
                  reviewed: reviewed.reviewed,
                  editRate: reviewed.reviewed > 0 ? reviewed.edited / reviewed.reviewed : null,
                  rejectionRate: reviewed.reviewed > 0 ? reviewed.dismissed / reviewed.reviewed : null,
                }
              : null,
        };
        stats.set(row.node_id, entry);
      }
      entry.runs += 1;
      if (row.fallback) entry.fallbacks += 1;
      entry.totalTokens += row.tokens;
      let day = entry.daily.at(-1);
      if (day?.day !== row.day) {
        day = { day: row.day, runs: 0, fallbacks: 0, edges: {} };
        entry.daily.push(day);
      }
      day.runs += 1;
      if (row.fallback) day.fallbacks += 1;
      if (kind === 'decide' && row.edge_taken) {
        entry.edges[row.edge_taken] = (entry.edges[row.edge_taken] ?? 0) + 1;
        day.edges[row.edge_taken] = (day.edges[row.edge_taken] ?? 0) + 1;
      }
    }
    for (const entry of stats.values()) {
      entry.fallbackRate = entry.runs > 0 ? entry.fallbacks / entry.runs : null;
      const withTokens = rows.filter((r) => r.node_id === entry.nodeId && r.tokens > 0).length;
      entry.avgTokens = withTokens > 0 ? Math.round(entry.totalTokens / withTokens) : null;
    }
    return [...stats.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  }

  async requestPublish(journeyId: string, number?: number): Promise<PublishRequestDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const journey = await this.journeys.get(journeyId);
    if (journey.status === 'archived') throw new ConflictException(`journeys_conflict: journey ${journeyId} is archived`);
    const draft = number ? await this.journeys.getVersion(journeyId, number) : journey.draft;
    if (!draft) throw new BadRequestException(`journeys_invalid: journey ${journeyId} has no draft to publish`);
    if (draft.publishedAt) {
      throw new ConflictException(`journeys_conflict: version ${draft.number} is already published`);
    }
    const validation = await this.journeys.validate(journeyId, draft.number);
    if (!validation.valid) {
      throw new BadRequestException(
        `journeys_invalid: version ${draft.number} has ${validation.errors.length} validation error(s): ${validation.errors
          .slice(0, 3)
          .map((e) => e.message)
          .join('; ')}`,
      );
    }
    const spec = JourneySpecSchema.parse(draft.spec);
    const live = journey.live ? JourneySpecSchema.parse(journey.live.spec) : null;
    const diff = diffSpecs(spec, live, journey.live?.number ?? null);
    const reviewStats = await this.nodeReviewStats(journeyId);
    const agentAuto = spec.nodes.filter(
      (n): n is Extract<JourneyNode, { type: 'message' }> => n.type === 'message' && n.draftBy === 'agent' && n.approval === 'auto',
    );
    const earned = new Map<string, NodeReviewStatsDto>();
    for (const node of agentAuto) {
      const [stats] = await this.nodeReviewStats(journeyId, { nodeId: node.id, brief: node.brief ?? '' });
      if (stats) earned.set(node.id, stats);
    }
    const notEarned = agentAuto.filter((n) => !earned.get(n.id)?.readyForAuto);
    if (notEarned.length > 0) {
      const detail = notEarned
        .map((n) => {
          const stats = earned.get(n.id);
          return `"${n.id}" has ${stats?.reviewed ?? 0} reviewed drafts from its current brief at ${Math.round((stats?.uneditedRate ?? 0) * 100)}% approved unedited`;
        })
        .join('; ');
      throw new BadRequestException(
        `journeys_invalid: an agent-drafted step can send without review only after ${AUTO_PROMOTION_MIN_REVIEWED} reviewed drafts in ${REVIEW_STATS_WINDOW_DAYS} days with at least ${AUTO_PROMOTION_MIN_UNEDITED_RATE * 100}% approved unedited — ${detail}`,
      );
    }
    const simulation = await this.simulator.simulate({ journeyId, spec, limit: 50, renderSamples: 2 });
    const pinnedTemplates = await autoTemplateHashes(spec);
    const fingerprint = publishFingerprint(journeyId, draft.number, draft.specHash, diff.autoNodes, pinnedTemplates);
    await ctx.db
      .update(schema.journeyVersions)
      .set({
        publishFingerprint: fingerprint,
        pinnedTemplates,
        publishRequestedAt: new Date(),
        publishRequestedByActorType: actor.type,
        publishRequestedByActorId: actor.id,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.journeyVersions.journeyId, journeyId), eq(schema.journeyVersions.number, draft.number)));
    await this.webhooks.emit({
      type: 'journey.version.publish_requested',
      payload: { journeyId, version: draft.number, fingerprint, autoNodes: diff.autoNodes },
    });
    return {
      journeyId,
      version: draft.number,
      fingerprint,
      diff,
      validation,
      simulation,
      reviewStats,
      autoMessages: autoMessagesOf(spec),
      reviewPath: `/dashboard/journeys/${journeyId}?publish=${draft.number}`,
    };
  }

  async confirmPublish(journeyId: string, number: number, fingerprint: string) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'user') {
      throw new ForbiddenException(
        'journeys_forbidden: only a person signed in to the Munin dashboard can publish a journey',
      );
    }
    const journey = await this.journeys.get(journeyId);
    if (journey.status === 'archived') throw new ConflictException(`journeys_conflict: journey ${journeyId} is archived`);
    const [row] = await ctx.db
      .select()
      .from(schema.journeyVersions)
      .where(and(eq(schema.journeyVersions.journeyId, journeyId), eq(schema.journeyVersions.number, number)))
      .limit(1);
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${journeyId} has no version ${number}`);
    if (row.publishedAt) throw new ConflictException(`journeys_conflict: version ${number} is already published`);
    if (!row.publishFingerprint || row.publishFingerprint !== fingerprint || row.specHash !== hashSpec(row.spec)) {
      throw new ConflictException(
        `journeys_conflict: version ${number} changed after its publish review was prepared — request publish again and review the new diff`,
      );
    }
    const spec = JourneySpecSchema.parse(row.spec);
    const pinned = await autoTemplateHashes(spec);
    if (JSON.stringify(pinned) !== JSON.stringify(row.pinnedTemplates)) {
      throw new ConflictException(
        `journeys_conflict: an email template used by an auto step changed after the publish review was prepared — request publish again and review it`,
      );
    }
    const now = new Date();
    await ctx.db
      .update(schema.journeyVersions)
      .set({ publishedAt: now, publishedByActorId: actor.id, updatedAt: now })
      .where(eq(schema.journeyVersions.id, row.id));
    await ctx.db
      .update(schema.journeys)
      .set({
        liveVersion: number,
        status: journey.status === 'paused' ? 'paused' : 'live',
        nextEntryAt:
          spec.entry.trigger.type === 'segment'
            ? spec.entry.trigger.schedule === 'once'
              ? now
              : nextScheduledEntry(spec.entry.trigger, now, spec.settings.timezone)
            : null,
        updatedAt: now,
      })
      .where(eq(schema.journeys.id, journeyId));
    await this.webhooks.emit({
      type: 'journey.version.published',
      payload: { journeyId, version: number, previousVersion: journey.liveVersion, publishedBy: actor.id },
    });
    return this.journeys.get(journeyId);
  }

  async report(journeyId: string, version?: number): Promise<JourneyReportDto> {
    const ctx = getCurrentContext();
    const journey = await this.journeys.get(journeyId);
    const e = schema.journeyEnrollments;
    const versionFilter = version ? sql`AND version = ${version}` : sql``;

    const states = await ctx.db
      .select({ state: e.state, exitReason: e.exitReason, holdout: e.holdout, n: count() })
      .from(e)
      .where(and(eq(e.journeyId, journeyId), version ? eq(e.version, version) : sql`true`))
      .groupBy(e.state, e.exitReason, e.holdout);
    const byState: Record<string, number> = {};
    const exitReasons: Record<string, number> = {};
    let total = 0;
    for (const row of states) {
      const n = Number(row.n);
      total += n;
      byState[row.state] = (byState[row.state] ?? 0) + n;
      if (row.exitReason) exitReasons[row.exitReason] = (exitReasons[row.exitReason] ?? 0) + n;
    }

    const goalRows = rowsOf(
      await ctx.db.execute(sql`
        SELECT holdout, count(*)::int AS entered, count(goal_reached_at)::int AS converted
          FROM journey_enrollments
         WHERE journey_id = ${journeyId} ${versionFilter}
         GROUP BY holdout
      `),
    ) as { holdout: boolean; entered: number; converted: number }[];
    const group = (holdout: boolean) => {
      const row = goalRows.find((r) => r.holdout === holdout);
      const entered = Number(row?.entered ?? 0);
      const converted = Number(row?.converted ?? 0);
      return { entered, converted, rate: entered > 0 ? converted / entered : null };
    };
    const treated = group(false);
    const holdout = group(true);

    const stepRows = rowsOf(
      await ctx.db.execute(sql`
        SELECT s.node_id, s.node_type, s.status, s.edge_taken, count(*)::int AS n
          FROM journey_step_runs s
          JOIN journey_enrollments en ON en.id = s.enrollment_id
         WHERE en.journey_id = ${journeyId} ${version ? sql`AND en.version = ${version}` : sql``}
         GROUP BY s.node_id, s.node_type, s.status, s.edge_taken
      `),
    ) as { node_id: string; node_type: string; status: string; edge_taken: string | null; n: number }[];
    const nodes = new Map<string, JourneyReportDto['nodes'][number]>();
    for (const row of stepRows) {
      const node = nodes.get(row.node_id) ?? {
        nodeId: row.node_id,
        nodeType: row.node_type,
        arrived: 0,
        waitingNow: 0,
        failed: 0,
        edges: {},
      };
      const n = Number(row.n);
      node.arrived += n;
      if (row.status === 'waiting') node.waitingNow += n;
      if (row.status === 'retrying' || (row.edge_taken === null && row.status === 'failed')) node.failed += n;
      if (row.edge_taken) node.edges[row.edge_taken] = (node.edges[row.edge_taken] ?? 0) + n;
      nodes.set(row.node_id, node);
    }

    const messageRows = rowsOf(
      await ctx.db.execute(sql`
        SELECT s.node_id, p.status, count(*)::int AS n
          FROM journey_step_runs s
          JOIN journey_enrollments en ON en.id = s.enrollment_id
          JOIN outreach_proposals p ON p.journey_step_run_id = s.id
         WHERE en.journey_id = ${journeyId} ${version ? sql`AND en.version = ${version}` : sql``}
         GROUP BY s.node_id, p.status
      `),
    ) as { node_id: string; status: string; n: number }[];
    const messages: Record<string, Record<string, number>> = {};
    for (const row of messageRows) {
      (messages[row.node_id] ??= {})[row.status] = Number(row.n);
    }

    const [duplicates] = rowsOf(
      await ctx.db.execute(sql`
        SELECT count(*)::int AS n FROM (
          SELECT m.metadata->>'journeyStepRunId' AS step_run_id
            FROM conv_messages m
            JOIN journey_step_runs s ON s.id = m.metadata->>'journeyStepRunId'
            JOIN journey_enrollments en ON en.id = s.enrollment_id
           WHERE en.journey_id = ${journeyId} ${version ? sql`AND en.version = ${version}` : sql``}
           GROUP BY 1
          HAVING count(*) > 1
        ) d
      `),
    ) as { n: number }[];
    const [untraced] = rowsOf(
      await ctx.db.execute(sql`
        SELECT count(*)::int AS n
          FROM journey_enrollments en
         WHERE en.journey_id = ${journeyId} ${versionFilter}
           AND en.holdout = false
           AND en.entered_at < now() - interval '5 minutes'
           AND NOT EXISTS (SELECT 1 FROM journey_step_runs s WHERE s.enrollment_id = en.id)
      `),
    ) as { n: number }[];

    return {
      journeyId,
      version: version ?? journey.liveVersion,
      integrity: {
        duplicateSends: Number(duplicates?.n ?? 0),
        enrollmentsWithoutTrace: Number(untraced?.n ?? 0),
      },
      enrollments: { total, byState, exitReasons },
      goal: {
        treated,
        holdout,
        lift:
          treated.rate !== null && holdout.rate !== null && holdout.entered > 0 ? treated.rate - holdout.rate : null,
      },
      nodes: [...nodes.values()].sort((a, b) => b.arrived - a.arrived),
      messages,
    };
  }

  async nodeReviewStats(journeyId: string, only?: { nodeId: string; brief: string }): Promise<NodeReviewStatsDto[]> {
    const ctx = getCurrentContext();
    await this.journeys.get(journeyId);
    const rows = rowsOf(
      await ctx.db.execute(sql`
        SELECT s.node_id,
               count(*) FILTER (WHERE p.status = 'sent' AND p.decided_by_actor_type = 'user' AND p.original_draft_body IS NULL)::int AS approved_unedited,
               count(*) FILTER (WHERE p.status = 'sent' AND p.decided_by_actor_type = 'user' AND p.original_draft_body IS NOT NULL)::int AS edited,
               count(*) FILTER (WHERE p.status = 'dismissed')::int AS dismissed,
               count(*) FILTER (WHERE p.status IN ('pending', 'approved'))::int AS pending,
               count(*) FILTER (WHERE p.status = 'sent' AND p.decided_by_actor_type IS DISTINCT FROM 'user')::int AS sent_without_review
          FROM outreach_proposals p
          JOIN journey_step_runs s ON s.id = p.journey_step_run_id
          JOIN journey_enrollments en ON en.id = s.enrollment_id
         WHERE en.journey_id = ${journeyId}
           AND p.created_at > now() - make_interval(days => ${REVIEW_STATS_WINDOW_DAYS})
           ${only ? sql`AND s.node_id = ${only.nodeId} AND p.evidence->>'draftedBy' = 'agent' AND p.evidence->>'brief' = ${only.brief}` : sql``}
         GROUP BY s.node_id
         ORDER BY s.node_id
      `),
    ) as {
      node_id: string;
      approved_unedited: number;
      edited: number;
      dismissed: number;
      pending: number;
      sent_without_review: number;
    }[];
    return rows.map((r) => {
      const reviewed = r.approved_unedited + r.edited + r.dismissed;
      const uneditedRate = reviewed > 0 ? r.approved_unedited / reviewed : null;
      return {
        nodeId: r.node_id,
        approvedUnedited: r.approved_unedited,
        edited: r.edited,
        dismissed: r.dismissed,
        pending: r.pending,
        sentWithoutReview: r.sent_without_review,
        reviewed,
        uneditedRate,
        readyForAuto:
          reviewed >= AUTO_PROMOTION_MIN_REVIEWED && (uneditedRate ?? 0) >= AUTO_PROMOTION_MIN_UNEDITED_RATE,
      };
    });
  }

  async splitResults(journeyId: string, version?: number): Promise<SplitResultDto[]> {
    const ctx = getCurrentContext();
    const journey = await this.journeys.get(journeyId);
    const row = version ? await this.journeys.getVersion(journeyId, version) : journey.live;
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${journeyId} has no live version`);
    const parsed = JourneySpecSchema.safeParse(row.spec);
    if (!parsed.success) return [];
    const results: SplitResultDto[] = [];
    for (const node of parsed.data.nodes) {
      if (node.type !== 'split') continue;
      const counts = rowsOf(
        await ctx.db.execute(sql`
          SELECT s.edge_taken AS path,
                 count(*)::int AS entered,
                 count(*) FILTER (WHERE en.goal_reached_at IS NOT NULL)::int AS converted
            FROM journey_step_runs s
            JOIN journey_enrollments en ON en.id = s.enrollment_id
           WHERE en.journey_id = ${journeyId}
             AND en.version = ${row.number}
             AND s.node_id = ${node.id}
             AND s.status = 'completed'
             AND NOT (s.output ? 'sampleFull')
           GROUP BY s.edge_taken
        `),
      ) as { path: string; entered: number; converted: number }[];
      const byPath = new Map(counts.map((c) => [c.path, c]));
      const control = node.control ? byPath.get(node.control) : undefined;
      const paths = node.paths.map((p): SplitPathResultDto => {
        const c = byPath.get(p.name) ?? { entered: 0, converted: 0 };
        const rate = c.entered > 0 ? c.converted / c.entered : null;
        const isControl = p.name === node.control;
        const comparable = !isControl && control && c.entered >= SPLIT_MIN_PER_PATH && control.entered >= SPLIT_MIN_PER_PATH;
        return {
          path: p.name,
          entered: c.entered,
          converted: c.converted,
          rate,
          liftVsControl:
            comparable && control.converted > 0 && rate !== null
              ? rate / (control.converted / control.entered) - 1
              : null,
          pValue: comparable ? twoProportionPValue(c.converted, c.entered, control.converted, control.entered) : null,
        };
      });
      const controlRate = control && control.entered > 0 ? control.converted / control.entered : 0;
      const total = counts.reduce((sum, c) => sum + c.entered, 0);
      const sampleFull = Boolean(node.sampleSize && total >= node.sampleSize);
      const significant = paths
        .filter((p) => p.pValue !== null && p.pValue < SPLIT_SIGNIFICANCE && (p.rate ?? 0) > controlRate)
        .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
      results.push({
        nodeId: node.id,
        version: row.number,
        control: node.control ?? null,
        sampleSize: node.sampleSize ?? null,
        sampleFull,
        paths,
        winner: sampleFull ? (significant[0]?.path ?? node.control ?? null) : null,
      });
    }
    return results;
  }

  async proposeChange(input: {
    journeyId: string;
    spec: Record<string, unknown>;
    rationale: string;
    hypothesis: string;
    evidence: Record<string, unknown>;
  }): Promise<ChangeProposalDto> {
    const ctx = getCurrentContext();
    const journey = await this.journeys.get(input.journeyId);
    if (journey.status !== 'live' || !journey.live) {
      throw new ConflictException(`journeys_conflict: only a live journey takes proposed changes; ${input.journeyId} is ${journey.status}`);
    }
    if (journey.draft) {
      throw new ConflictException(
        `journeys_conflict: draft v${journey.draft.number} is still open; publish or restore it before proposing another change`,
      );
    }
    const draft = await this.journeys.replaceDraft(input.journeyId, input.spec, `Proposed: ${input.hypothesis.slice(0, 200)}`);
    const validation = await this.journeys.validate(input.journeyId, draft.number);
    let simulation: ChangeProposalDto['simulation'] = null;
    let diff: JourneyDiff = { againstVersion: journey.live.number, addedNodes: [], removedNodes: [], changedNodes: [], changedBlocks: [], autoNodes: [] };
    const parsed = JourneySpecSchema.safeParse(draft.spec);
    if (parsed.success) {
      diff = diffSpecs(parsed.data, JourneySpecSchema.parse(journey.live.spec), journey.live.number);
      if (validation.valid) {
        const sim = await this.simulate({ journeyId: input.journeyId, version: draft.number, limit: 200, renderSamples: 0 });
        simulation = { entered: sim.entered, exits: sim.exits, edges: sim.edges, estimatedAgentUsd: sim.agentCost.estimatedUsd };
      }
    }
    await ctx.db
      .update(schema.journeyVersions)
      .set({
        proposal: {
          rationale: input.rationale,
          hypothesis: input.hypothesis,
          evidence: input.evidence,
          simulation,
          proposedBy: { type: ctx.actor!.type, id: ctx.actor!.id },
          proposedAt: new Date().toISOString(),
        },
      })
      .where(and(eq(schema.journeyVersions.journeyId, input.journeyId), eq(schema.journeyVersions.number, draft.number)));
    await this.webhooks.emit({
      type: 'journey.change.proposed',
      payload: { journeyId: input.journeyId, version: draft.number, hypothesis: input.hypothesis },
    });
    return { version: draft.number, diff, validation, simulation };
  }

  private async parsedVersion(journeyId: string, number?: number): Promise<{ version: number; spec: JourneySpec }> {
    const journey = await this.journeys.get(journeyId);
    const row = number
      ? await this.journeys.getVersion(journeyId, number)
      : (journey.draft ?? journey.live);
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${journeyId} has no version to simulate`);
    const parsed = JourneySpecSchema.safeParse(row.spec);
    if (!parsed.success) {
      throw new BadRequestException(`journeys_invalid: version ${row.number} does not parse; run journeys_validate`);
    }
    return { version: row.number, spec: parsed.data };
  }
}

export function publishFingerprint(
  journeyId: string,
  version: number,
  specHash: string,
  autoNodes: string[],
  templates: Record<string, string> = {},
): string {
  const canonical = JSON.stringify([
    journeyId,
    version,
    specHash,
    [...autoNodes].sort(),
    Object.entries(templates).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

async function autoTemplateHashes(spec: JourneySpec): Promise<Record<string, string>> {
  const pinned: Record<string, string> = {};
  for (const node of spec.nodes) {
    if (node.type !== 'message' || node.channel !== 'email' || node.approval !== 'auto') continue;
    const hash = await emailTemplateHash(node.content.templateId ?? null);
    if (!hash) throw new BadRequestException(`journeys_invalid: email template ${node.content.templateId} used by "${node.id}" does not exist`);
    pinned[node.id] = hash;
  }
  return pinned;
}

function autoMessagesOf(spec: JourneySpec): PublishRequestDto['autoMessages'] {
  return spec.nodes
    .filter((n): n is Extract<JourneyNode, { type: 'message' }> => n.type === 'message' && n.approval === 'auto')
    .map((n) => ({
      nodeId: n.id,
      channel: n.channel,
      class: n.class,
      subject: n.content.subject ?? null,
      preview: n.content.body.slice(0, 600),
      draftBy: n.draftBy ?? null,
    }));
}

export function diffSpecs(next: JourneySpec, live: JourneySpec | null, liveVersion: number | null): JourneyDiff {
  const autoNodes = next.nodes
    .filter((n): n is Extract<JourneyNode, { type: 'message' }> => n.type === 'message' && n.approval === 'auto')
    .map((n) => n.id);
  if (!live) {
    return {
      againstVersion: null,
      addedNodes: next.nodes.map((n) => n.id),
      removedNodes: [],
      changedNodes: [],
      changedBlocks: ['entry', 'exit', 'goal', 'settings', 'start'],
      autoNodes,
    };
  }
  const before = new Map(live.nodes.map((n) => [n.id, hashSpec(n)]));
  const after = new Map(next.nodes.map((n) => [n.id, hashSpec(n)]));
  return {
    againstVersion: liveVersion,
    addedNodes: [...after.keys()].filter((id) => !before.has(id)),
    removedNodes: [...before.keys()].filter((id) => !after.has(id)),
    changedNodes: [...after.entries()].filter(([id, h]) => before.has(id) && before.get(id) !== h).map(([id]) => id),
    changedBlocks: (['entry', 'exit', 'goal', 'settings', 'start'] as const).filter(
      (key) => hashSpec(next[key] ?? null) !== hashSpec(live[key] ?? null),
    ),
    autoNodes,
  };
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

const AGENT_JOB_URI: Record<AgentStepKind, string> = {
  decide: DECIDE_STEP_JOB_URI,
  enrich: ENRICH_STEP_JOB_URI,
  draft: DRAFT_STEP_JOB_URI,
};

function agentKindOf(node: JourneyNode): AgentStepKind | null {
  if (node.type === 'agent') return node.mode === 'enrich' ? 'enrich' : 'decide';
  if (node.type === 'message' && node.draftBy === 'agent') return 'draft';
  return null;
}

function twoProportionPValue(x1: number, n1: number, x2: number, n2: number): number {
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = Math.abs(x1 / n1 - x2 / n2) / se;
  return Math.min(1, 2 * (1 - normalCdf(z)));
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 1 - tail;
}
