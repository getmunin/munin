import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';

export const CURATOR_JOB_STATUSES = ['pending', 'done', 'failed', 'dead'] as const;
export type CuratorJobStatus = (typeof CURATOR_JOB_STATUSES)[number];

const BACKOFF_BASE_MS = 30_000;

export interface CuratorJobDto {
  id: string;
  orgId: string;
  jobUri: string;
  userPrompt: string;
  sourceEventType: string | null;
  sourceEventPayload: unknown;
  dedupeKey: string | null;
  status: CuratorJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseExpiresAt: string | null;
  leaseHolder: string | null;
  lastError: string | null;
  lastReplyText: string | null;
  lastToolCalls: number | null;
  lastTotalTokens: number | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

export interface EnqueueInput {
  jobUri: string;
  userPrompt: string;
  sourceEventType?: string;
  sourceEventPayload?: unknown;
  dedupeKey?: string;
  maxAttempts?: number;
  delaySeconds?: number;
}

export interface EnqueueResult {
  job: CuratorJobDto;
  alreadyPending: boolean;
}

export interface ClaimInput {
  limit?: number;
  leaseSeconds?: number;
  holder: string;
}

export interface AckInput {
  id: string;
  replyText?: string;
  toolCalls?: number;
  totalTokens?: number;
}

export interface FailInput {
  id: string;
  error: string;
  retryable?: boolean;
}

@Injectable()
export class CuratorJobsService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    if (!input.jobUri.startsWith('skill://') && !input.jobUri.startsWith('task://')) {
      throw new BadRequestException('jobUri must start with skill:// or task://');
    }
    if (!input.userPrompt.trim()) {
      throw new BadRequestException('userPrompt is required');
    }
    const ctx = getCurrentContext();
    if (!ctx.actor?.orgId) throw new BadRequestException('actor org required to enqueue');

    const nextAt = new Date(Date.now() + (input.delaySeconds ?? 0) * 1000);
    let row: Row | null = null;
    try {
      row = await (ctx.db as Db).transaction(async (sp) => {
        const inserted = await sp
          .insert(schema.curatorJobs)
          .values({
            orgId: ctx.actor!.orgId,
            jobUri: input.jobUri,
            userPrompt: input.userPrompt,
            sourceEventType: input.sourceEventType ?? null,
            sourceEventPayload: input.sourceEventPayload ?? null,
            dedupeKey: input.dedupeKey ?? null,
            status: 'pending',
            attempts: 0,
            maxAttempts: input.maxAttempts ?? 5,
            nextAttemptAt: nextAt,
          })
          .returning();
        const first = inserted[0];
        if (!first) throw new Error('curator_jobs insert returned no row');
        return first;
      });
    } catch (err) {
      if (!(input.dedupeKey && isUniqueViolation(err, 'curator_jobs_dedupe_uq'))) {
        throw err;
      }
    }
    if (!row) {
      const [existing] = await ctx.db
        .select()
        .from(schema.curatorJobs)
        .where(
          and(
            eq(schema.curatorJobs.orgId, ctx.actor.orgId),
            eq(schema.curatorJobs.dedupeKey, input.dedupeKey!),
            eq(schema.curatorJobs.status, 'pending'),
          ),
        )
        .limit(1);
      if (!existing) throw new Error('curator_jobs dedup race but no existing row');
      return { job: toDto(existing), alreadyPending: true };
    }
    await this.webhooks.emit({
      type: 'curator_job.pending',
      payload: {
        jobId: row.id,
        jobUri: row.jobUri,
        dedupeKey: row.dedupeKey,
        nextAttemptAt: toIso(row.nextAttemptAt),
      },
    });
    return { job: toDto(row), alreadyPending: false };
  }

  async claim(input: ClaimInput): Promise<CuratorJobDto[]> {
    const ctx = getCurrentContext();
    if (!ctx.actor?.orgId) throw new BadRequestException('actor org required to claim');
    const limit = Math.max(1, Math.min(input.limit ?? 1, 25));
    const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? 600, 3600));
    const nowIso = new Date().toISOString();
    const leaseUntilIso = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    const rows = await ctx.db.execute<Record<string, unknown>>(sql`
      WITH due AS (
        SELECT id FROM curator_jobs
        WHERE org_id = ${ctx.actor.orgId}
          AND status = 'pending'
          AND next_attempt_at <= ${nowIso}::timestamptz
          AND (lease_expires_at IS NULL OR lease_expires_at < ${nowIso}::timestamptz)
        ORDER BY next_attempt_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE curator_jobs
      SET lease_expires_at = ${leaseUntilIso}::timestamptz,
          lease_holder = ${input.holder},
          attempts = attempts + 1,
          updated_at = now()
      WHERE id IN (SELECT id FROM due)
      RETURNING *;
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
    return (list as Record<string, unknown>[]).map(rowFromSql).map(toDto);
  }

  async ack(input: AckInput): Promise<CuratorJobDto> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .update(schema.curatorJobs)
      .set({
        status: 'done',
        leaseExpiresAt: null,
        leaseHolder: null,
        lastError: null,
        lastReplyText: input.replyText ?? null,
        lastToolCalls: input.toolCalls ?? null,
        lastTotalTokens: input.totalTokens ?? null,
        doneAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.curatorJobs.id, input.id))
      .returning();
    if (!row) throw new NotFoundException(`curator_job ${input.id} not found`);
    return toDto(row);
  }

  async fail(input: FailInput): Promise<CuratorJobDto> {
    const ctx = getCurrentContext();
    const [current] = await ctx.db
      .select()
      .from(schema.curatorJobs)
      .where(eq(schema.curatorJobs.id, input.id))
      .limit(1);
    if (!current) throw new NotFoundException(`curator_job ${input.id} not found`);

    const retryable = input.retryable !== false;
    const reachedMax = current.attempts >= current.maxAttempts;
    const status: CuratorJobStatus = !retryable ? 'failed' : reachedMax ? 'dead' : 'pending';
    const backoffMs = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, current.attempts - 1));
    const nextAt = status === 'pending' ? new Date(Date.now() + backoffMs) : current.nextAttemptAt;

    const [row] = await ctx.db
      .update(schema.curatorJobs)
      .set({
        status,
        nextAttemptAt: nextAt,
        leaseExpiresAt: null,
        leaseHolder: null,
        lastError: input.error.slice(0, 4000),
        updatedAt: new Date(),
      })
      .where(eq(schema.curatorJobs.id, input.id))
      .returning();
    if (!row) throw new NotFoundException(`curator_job ${input.id} not found`);
    if (row.status === 'pending') {
      await this.webhooks.emit({
        type: 'curator_job.pending',
        payload: {
          jobId: row.id,
          jobUri: row.jobUri,
          dedupeKey: row.dedupeKey,
          nextAttemptAt: toIso(row.nextAttemptAt),
        },
      });
    }
    return toDto(row);
  }

  async releaseStaleLeases(): Promise<number> {
    const ctx = getCurrentContext();
    const now = new Date();
    const result = await ctx.db
      .update(schema.curatorJobs)
      .set({ leaseExpiresAt: null, leaseHolder: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.curatorJobs.status, 'pending'),
          or(
            isNull(schema.curatorJobs.leaseExpiresAt),
            lte(schema.curatorJobs.leaseExpiresAt, now),
          ),
        ),
      )
      .returning({ id: schema.curatorJobs.id });
    return result.length;
  }

  async get(id: string): Promise<CuratorJobDto> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.curatorJobs)
      .where(eq(schema.curatorJobs.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`curator_job ${id} not found`);
    return toDto(row);
  }

  async list(input: { status?: CuratorJobStatus; limit?: number }): Promise<CuratorJobDto[]> {
    const ctx = getCurrentContext();
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const where = input.status ? eq(schema.curatorJobs.status, input.status) : undefined;
    const rows = await ctx.db
      .select()
      .from(schema.curatorJobs)
      .where(where)
      .orderBy(schema.curatorJobs.createdAt)
      .limit(limit);
    return rows.map(toDto);
  }
}

type Row = typeof schema.curatorJobs.$inferSelect;

function toDto(row: Row): CuratorJobDto {
  return {
    id: row.id,
    orgId: row.orgId,
    jobUri: row.jobUri,
    userPrompt: row.userPrompt,
    sourceEventType: row.sourceEventType,
    sourceEventPayload: row.sourceEventPayload ?? null,
    dedupeKey: row.dedupeKey,
    status: row.status as CuratorJobStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: toIso(row.nextAttemptAt),
    leaseExpiresAt: row.leaseExpiresAt ? toIso(row.leaseExpiresAt) : null,
    leaseHolder: row.leaseHolder,
    lastError: row.lastError,
    lastReplyText: row.lastReplyText,
    lastToolCalls: row.lastToolCalls,
    lastTotalTokens: row.lastTotalTokens,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    doneAt: row.doneAt ? toIso(row.doneAt) : null,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  const target = (cause && typeof cause === 'object' ? cause : err) as {
    code?: string;
    constraint_name?: string;
  };
  return target.code === '23505' && target.constraint_name === constraint;
}

function rowFromSql(raw: Record<string, unknown>): Row {
  return {
    id: raw.id as string,
    orgId: raw.org_id as string,
    jobUri: raw.job_uri as string,
    userPrompt: raw.user_prompt as string,
    sourceEventType: (raw.source_event_type as string | null) ?? null,
    sourceEventPayload: raw.source_event_payload ?? null,
    dedupeKey: (raw.dedupe_key as string | null) ?? null,
    status: raw.status as string,
    attempts: Number(raw.attempts),
    maxAttempts: Number(raw.max_attempts),
    nextAttemptAt: raw.next_attempt_at as Date,
    leaseExpiresAt: (raw.lease_expires_at as Date | null) ?? null,
    leaseHolder: (raw.lease_holder as string | null) ?? null,
    lastError: (raw.last_error as string | null) ?? null,
    lastReplyText: (raw.last_reply_text as string | null) ?? null,
    lastToolCalls: raw.last_tool_calls != null ? Number(raw.last_tool_calls) : null,
    lastTotalTokens: raw.last_total_tokens != null ? Number(raw.last_total_tokens) : null,
    createdAt: raw.created_at as Date,
    updatedAt: raw.updated_at as Date,
    doneAt: (raw.done_at as Date | null) ?? null,
  };
}
