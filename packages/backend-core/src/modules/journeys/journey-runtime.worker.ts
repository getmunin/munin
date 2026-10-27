import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DEFAULT_TRACE_RETENTION_DAYS } from '@getmunin/types';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  getCurrentContext,
  parseEnvDisableFlag,
  parseEnvInt,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { applyTenancyGUCs } from '../../common/tenancy/tenancy.interceptor.ts';
import { JourneyRuntimeService } from './journey-runtime.service.ts';
import { JourneyMonitorService } from './journey-monitor.service.ts';
import { JOURNEY_RUNTIME_ACTOR_ID } from './journey-event.sink.ts';

const DEFAULT_INTERVAL_MS = 5_000;
const INBOX_BATCH = 200;
const RUN_BATCH = 50;
const INBOX_RETENTION_MS = 7 * 86_400_000;
const INBOX_MAX_ATTEMPTS = 6;
const DEFAULT_MONITOR_INTERVAL_MS = 15 * 60_000;

export interface JourneyTickResult {
  events: number;
  waits: number;
  entries: number;
  runs: number;
  guardrailActions: number;
}

@Injectable()
export class JourneyRuntimeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JourneyRuntimeWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastPurgeAt = 0;
  private lastMonitorAt = 0;
  private lastTracePurgeAt = 0;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_JOURNEYS_WORKER_DISABLED') || process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_JOURNEYS_POLL_MS',
    default: DEFAULT_INTERVAL_MS,
  });
  private readonly monitorIntervalMs = parseEnvInt({
    name: 'MUNIN_JOURNEYS_MONITOR_MS',
    default: DEFAULT_MONITOR_INTERVAL_MS,
    min: 0,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly runtime: JourneyRuntimeService,
    @Optional() @Inject(JourneyMonitorService) private readonly monitor: Pick<JourneyMonitorService, 'enforce'> | null = null,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(`journey runtime worker starting (every ${this.intervalMs}ms)`);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()): Promise<JourneyTickResult> {
    const result: JourneyTickResult = { events: 0, waits: 0, entries: 0, runs: 0, guardrailActions: 0 };
    if (this.running) return result;
    this.running = true;
    try {
      result.events = await this.phase('inbox', () => this.drainInbox(), 0);
      result.waits = await this.phase('waits', () => this.wakeWaits(now), 0);
      result.entries = await this.phase('entries', () => this.runEntries(now), 0);
      result.runs = await this.phase('runs', () => this.runEnrollments(now), 0);
      result.guardrailActions = await this.phase('monitor', () => this.runMonitor(now), 0);
      await this.phase('purge', () => this.purgeInbox(now), undefined);
      if (now.getTime() - this.lastTracePurgeAt >= 86_400_000) {
        this.lastTracePurgeAt = now.getTime();
        await this.phase('traces', () => this.purgeTraces(now), 0);
      }
    } finally {
      this.running = false;
    }
    return result;
  }

  private async phase<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(`journey ${name} phase failed: ${describe(err)}`);
      return fallback;
    }
  }

  private async drainInbox(): Promise<number> {
    const pending = await this.bypass((tx) =>
      tx
        .select({ id: schema.journeyEventInbox.id, orgId: schema.journeyEventInbox.orgId })
        .from(schema.journeyEventInbox)
        .where(
          and(
            isNull(schema.journeyEventInbox.processedAt),
            or(isNull(schema.journeyEventInbox.nextAttemptAt), lte(schema.journeyEventInbox.nextAttemptAt, new Date())),
          ),
        )
        .orderBy(asc(schema.journeyEventInbox.createdAt))
        .limit(INBOX_BATCH),
    );
    let processed = 0;
    for (const item of pending) {
      try {
        const done = await this.inOrg(item.orgId, async () => {
          const ctx = getCurrentContext();
          const locked = await ctx.db.execute(
            sql`SELECT id FROM journey_event_inbox WHERE id = ${item.id} AND processed_at IS NULL FOR UPDATE SKIP LOCKED`,
          );
          if (rowsOf(locked).length === 0) return false;
          const [row] = await ctx.db
            .select()
            .from(schema.journeyEventInbox)
            .where(eq(schema.journeyEventInbox.id, item.id))
            .limit(1);
          await this.runtime.processInboxRow(row!);
          await ctx.db
            .update(schema.journeyEventInbox)
            .set({ processedAt: new Date() })
            .where(eq(schema.journeyEventInbox.id, item.id));
          return true;
        });
        if (done) processed += 1;
      } catch (err) {
        this.logger.warn(`journey inbox ${item.id} failed: ${describe(err)}`);
        await this.inOrg(item.orgId, () => {
          const i = schema.journeyEventInbox;
          return getCurrentContext()
            .db.update(i)
            .set({
              attempts: sql`${i.attempts} + 1`,
              lastError: describe(err).slice(0, 1000),
              nextAttemptAt: sql`now() + make_interval(secs => 30 * power(2, ${i.attempts}))`,
              processedAt: sql`CASE WHEN ${i.attempts} + 1 >= ${INBOX_MAX_ATTEMPTS} THEN now() ELSE NULL END`,
            })
            .where(eq(i.id, item.id));
        }).catch(() => undefined);
      }
    }
    return processed;
  }

  private async wakeWaits(now: Date): Promise<number> {
    const orgs = await this.bypass(async (tx) => {
      const at = now.toISOString();
      const rows = await tx.execute(sql`
        SELECT DISTINCT org_id FROM journey_waits
         WHERE resolved_at IS NULL AND (wake_at <= ${at}::timestamptz OR timeout_at <= ${at}::timestamptz)
        UNION
        SELECT DISTINCT org_id FROM journey_enrollments
         WHERE state IN ('active', 'waiting') AND idle_deadline_at <= ${at}::timestamptz
      `);
      return rowsOf(rows).map((r) => (r as { org_id: string }).org_id);
    });
    let woken = 0;
    for (const orgId of orgs) {
      try {
        woken += await this.inOrg(orgId, () => this.runtime.resolveDueWaits(now));
      } catch (err) {
        this.logger.warn(`journey waits for ${orgId} failed: ${describe(err)}`);
      }
    }
    return woken;
  }

  private async runEntries(now: Date): Promise<number> {
    const orgs = await this.bypass((tx) =>
      tx
        .selectDistinct({ orgId: schema.journeys.orgId })
        .from(schema.journeys)
        .where(and(eq(schema.journeys.status, 'live'), lte(schema.journeys.nextEntryAt, now))),
    );
    let enrolled = 0;
    for (const { orgId } of orgs) {
      try {
        enrolled += await this.inOrg(orgId, () => this.runtime.runScheduledEntries(now));
      } catch (err) {
        this.logger.warn(`journey scheduled entry for ${orgId} failed: ${describe(err)}`);
      }
    }
    return enrolled;
  }

  private async runEnrollments(tickAt: Date): Promise<number> {
    const now = new Date(Math.max(tickAt.getTime(), Date.now()));
    const due = await this.bypass((tx) =>
      tx
        .select({ id: schema.journeyEnrollments.id, orgId: schema.journeyEnrollments.orgId })
        .from(schema.journeyEnrollments)
        .innerJoin(schema.journeys, eq(schema.journeys.id, schema.journeyEnrollments.journeyId))
        .where(
          and(
            eq(schema.journeyEnrollments.state, 'active'),
            lte(schema.journeyEnrollments.nextRunAt, now),
            eq(schema.journeys.status, 'live'),
          ),
        )
        .orderBy(asc(schema.journeyEnrollments.nextRunAt))
        .limit(RUN_BATCH),
    );
    let runs = 0;
    for (const item of due) {
      try {
        await this.inOrg(item.orgId, () => this.runtime.runEnrollment(item.id, now));
        runs += 1;
      } catch (err) {
        this.logger.warn(`journey enrollment ${item.id} failed: ${describe(err)}`);
        await this.inOrg(item.orgId, () =>
          getCurrentContext()
            .db.update(schema.journeyEnrollments)
            .set({ nextRunAt: new Date(now.getTime() + 60_000) })
            .where(eq(schema.journeyEnrollments.id, item.id)),
        ).catch(() => undefined);
      }
    }
    return runs;
  }

  async runMonitor(now: Date, force = false): Promise<number> {
    if (!this.monitor) return 0;
    if (!force && now.getTime() - this.lastMonitorAt < this.monitorIntervalMs) return 0;
    this.lastMonitorAt = now.getTime();
    const orgs = await this.bypass((tx) =>
      tx
        .selectDistinct({ orgId: schema.journeys.orgId })
        .from(schema.journeys)
        .where(eq(schema.journeys.status, 'live')),
    );
    let actions = 0;
    for (const { orgId } of orgs) {
      try {
        actions += (await this.inOrg(orgId, () => this.monitor!.enforce())).length;
      } catch (err) {
        this.logger.warn(`journey monitor for ${orgId} failed: ${describe(err)}`);
      }
    }
    return actions;
  }

  private async purgeInbox(now: Date): Promise<void> {
    if (now.getTime() - this.lastPurgeAt < 3_600_000) return;
    this.lastPurgeAt = now.getTime();
    await this.bypass((tx) =>
      tx
        .delete(schema.journeyEventInbox)
        .where(lt(schema.journeyEventInbox.processedAt, new Date(now.getTime() - INBOX_RETENTION_MS))),
    );
  }

  async purgeTraces(now: Date, batch = 1000): Promise<number> {
    const at = now.toISOString();
    return this.bypass(async (tx) => {
      const due = rowsOf(
        await tx.execute(sql`
          SELECT en.id
            FROM journey_enrollments en
            JOIN journeys j ON j.id = en.journey_id
            LEFT JOIN journey_versions v ON v.journey_id = j.id AND v.number = coalesce(j.live_version, en.version)
           WHERE en.state IN ('done', 'exited')
             AND en.exited_at < ${at}::timestamptz - make_interval(days => coalesce((v.spec->'settings'->>'traceRetentionDays')::int, ${DEFAULT_TRACE_RETENTION_DAYS}))
             AND (en.context <> '{}'::jsonb OR EXISTS (SELECT 1 FROM journey_step_runs s WHERE s.enrollment_id = en.id))
           LIMIT ${batch}
        `),
      ).map((r) => (r as { id: string }).id);
      if (due.length === 0) return 0;
      await tx.delete(schema.journeyWaits).where(inArray(schema.journeyWaits.enrollmentId, due));
      await tx.delete(schema.journeyStepRuns).where(inArray(schema.journeyStepRuns.enrollmentId, due));
      await tx
        .update(schema.journeyEnrollments)
        .set({ context: {}, updatedAt: new Date() })
        .where(inArray(schema.journeyEnrollments.id, due));
      return due.length;
    });
  }

  private bypass<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      return fn(tx as unknown as Db);
    });
  }

  private inOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('system', JOURNEY_RUNTIME_ACTOR_ID, orgId, ['*'], ['admin']);
    return this.db.transaction(async (tx) => {
      await applyTenancyGUCs(tx, actor);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
