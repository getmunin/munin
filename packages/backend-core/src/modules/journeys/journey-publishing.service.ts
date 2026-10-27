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
import { JourneySpecSchema, type JourneyNode, type JourneySpec } from '@getmunin/types';
import { JourneysService, hashSpec } from './journeys.service.ts';
import { JourneySimulator, type SimulationResult } from './journey-simulator.ts';
import type { JourneyValidation } from './journey-validator.ts';

export interface JourneyDiff {
  againstVersion: number | null;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  changedBlocks: string[];
  autoNodes: string[];
}

export interface PublishRequestDto {
  journeyId: string;
  version: number;
  fingerprint: string;
  diff: JourneyDiff;
  validation: JourneyValidation;
  simulation: SimulationResult;
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
  }): Promise<SimulationResult & { version: number }> {
    const { version, spec } = await this.parsedVersion(input.journeyId, input.version);
    const result = await this.simulator.simulate({ ...input, spec });
    return { version, ...result };
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
    const simulation = await this.simulator.simulate({ journeyId, spec, limit: 50, renderSamples: 2 });
    const fingerprint = publishFingerprint(journeyId, draft.number, draft.specHash, diff.autoNodes);
    await ctx.db
      .update(schema.journeyVersions)
      .set({
        publishFingerprint: fingerprint,
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
        nextEntryAt: spec.entry.trigger.type === 'segment' ? now : null,
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

export function publishFingerprint(journeyId: string, version: number, specHash: string, autoNodes: string[]): string {
  const canonical = JSON.stringify([journeyId, version, specHash, [...autoNodes].sort()]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
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
