import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { assertOwnerOrAdmin } from './role-guard.ts';

export interface UsageSummaryTile {
  current: number;
  previous: number;
  sparkline: number[];
}

export interface UsageSummaryDto {
  mcpCalls: UsageSummaryTile & { period: 'month' };
  apiCalls: UsageSummaryTile & { period: 'month' };
  conversations: UsageSummaryTile & { period: 'month' };
  avgLatencyMs: UsageSummaryTile & { period: '7d' };
}

export interface AgentUsageDto {
  id: string;
  name: string;
  description: string | null;
  mcpCalls: number;
  avgLatencyMs: number | null;
}

export interface UsageByAgentDto {
  rangeDays: number;
  agents: AgentUsageDto[];
}

type DailyRow = {
  day: string;
  value: number;
} & Record<string, unknown>;

type AgentAggRow = {
  actor_id: string;
  call_count: number;
  avg_ms: number | null;
} & Record<string, unknown>;

type DailyAvgRow = {
  day: string;
  avg_ms: number | null;
} & Record<string, unknown>;

type DailyBigIntRow = {
  day: string;
  value: string;
} & Record<string, unknown>;

@Controller('v1/usage')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class UsageStatsController {
  @Get('summary')
  async summary(): Promise<UsageSummaryDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
    const orgId = actor.orgId;

    const now = new Date();
    const monthStart = startOfMonth(now);
    const prevMonthStart = startOfMonth(addMonths(monthStart, -1));
    const sevenAgo = addDays(startOfDay(now), -6);
    const fourteenAgo = addDays(startOfDay(now), -13);

    const monthSparkStart = addDays(startOfDay(now), -29);

    const [mcp, api, conv, lat] = await Promise.all([
      this.mcpCallsTile(orgId, monthStart, prevMonthStart, monthSparkStart, now),
      this.apiCallsTile(orgId, monthStart, prevMonthStart, monthSparkStart, now),
      this.conversationsTile(orgId, monthStart, prevMonthStart, monthSparkStart, now),
      this.latencyTile(orgId, sevenAgo, fourteenAgo, now),
    ]);

    return {
      mcpCalls: { ...mcp, period: 'month' },
      apiCalls: { ...api, period: 'month' },
      conversations: { ...conv, period: 'month' },
      avgLatencyMs: { ...lat, period: '7d' },
    };
  }

  @Get('by-agent')
  async byAgent(@Query('days') daysRaw?: string): Promise<UsageByAgentDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
    const orgId = actor.orgId;

    const days = clampDays(daysRaw, 30);
    const since = addDays(startOfDay(new Date()), -(days - 1));

    const rows = await ctx.db.execute<AgentAggRow>(sql`
      SELECT actor_id,
             count(*)::int AS call_count,
             avg(duration_ms)::float8 AS avg_ms
      FROM audit_log
      WHERE org_id = ${orgId}
        AND tool IS NOT NULL
        AND actor_type IN ('admin_agent', 'end_user_agent')
        AND actor_id IS NOT NULL
        AND created_at >= ${since.toISOString()}::timestamptz
      GROUP BY actor_id
    `);

    const agentRows = await ctx.db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        description: schema.agents.description,
      })
      .from(schema.agents);
    const byId = new Map(agentRows.map((a) => [a.id, a]));

    const items: AgentUsageDto[] = rows
      .map((r) => {
        const agent = byId.get(r.actor_id);
        if (!agent) return null;
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          mcpCalls: Number(r.call_count) || 0,
          avgLatencyMs: r.avg_ms == null ? null : Math.round(Number(r.avg_ms)),
        };
      })
      .filter((a): a is AgentUsageDto => a !== null)
      .sort((a, b) => b.mcpCalls - a.mcpCalls);

    return { rangeDays: days, agents: items };
  }

  private async mcpCallsTile(
    orgId: string,
    monthStart: Date,
    prevMonthStart: Date,
    sparkStart: Date,
    now: Date,
  ): Promise<UsageSummaryTile> {
    const ctx = getCurrentContext();
    const rows = await ctx.db.execute<DailyBigIntRow>(sql`
      SELECT to_char(date_trunc('day', window_start AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             sum(count)::bigint AS value
      FROM rate_limit_counters
      WHERE org_id = ${orgId}
        AND bucket = 'mcp_calls_day'
        AND window_start >= ${prevMonthStart.toISOString()}::timestamptz
      GROUP BY 1
    `);
    const byDay = mapDailyRows(rows.map((r) => ({ day: r.day, value: Number(r.value) || 0 })));
    const monthKey = toUtcDateKey(monthStart);
    return {
      current: sumWhere(byDay, (k) => k >= monthKey),
      previous: sumWhere(byDay, (k) => k < monthKey),
      sparkline: dailySeries(byDay, sparkStart, now),
    };
  }

  private async apiCallsTile(
    orgId: string,
    monthStart: Date,
    prevMonthStart: Date,
    sparkStart: Date,
    now: Date,
  ): Promise<UsageSummaryTile> {
    const ctx = getCurrentContext();
    const rows = await ctx.db.execute<DailyRow>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             count(*)::int AS value
      FROM audit_log
      WHERE org_id = ${orgId}
        AND tool IS NULL
        AND method IS NOT NULL
        AND actor_type <> 'user'
        AND method NOT LIKE 'POST /mcp%'
        AND method NOT LIKE 'GET /mcp%'
        AND method NOT LIKE 'DELETE /mcp%'
        AND created_at >= ${prevMonthStart.toISOString()}::timestamptz
      GROUP BY 1
    `);
    const byDay = mapDailyRows(rows);
    const monthKey = toUtcDateKey(monthStart);
    return {
      current: sumWhere(byDay, (k) => k >= monthKey),
      previous: sumWhere(byDay, (k) => k < monthKey),
      sparkline: dailySeries(byDay, sparkStart, now),
    };
  }

  private async conversationsTile(
    orgId: string,
    monthStart: Date,
    prevMonthStart: Date,
    sparkStart: Date,
    now: Date,
  ): Promise<UsageSummaryTile> {
    const ctx = getCurrentContext();
    const rows = await ctx.db.execute<DailyRow>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             count(*)::int AS value
      FROM conv_conversations
      WHERE org_id = ${orgId}
        AND created_at >= ${prevMonthStart.toISOString()}::timestamptz
      GROUP BY 1
    `);
    const byDay = mapDailyRows(rows);
    const monthKey = toUtcDateKey(monthStart);
    return {
      current: sumWhere(byDay, (k) => k >= monthKey),
      previous: sumWhere(byDay, (k) => k < monthKey),
      sparkline: dailySeries(byDay, sparkStart, now),
    };
  }

  private async latencyTile(
    orgId: string,
    windowStart: Date,
    prevWindowStart: Date,
    now: Date,
  ): Promise<UsageSummaryTile> {
    const ctx = getCurrentContext();
    const rows = await ctx.db.execute<DailyAvgRow>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             avg(duration_ms)::float8 AS avg_ms
      FROM audit_log
      WHERE org_id = ${orgId}
        AND tool IS NOT NULL
        AND duration_ms IS NOT NULL
        AND result = 'ok'
        AND created_at >= ${prevWindowStart.toISOString()}::timestamptz
      GROUP BY 1
    `);
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (r.avg_ms == null) continue;
      byDay.set(r.day, Math.round(Number(r.avg_ms)));
    }
    const windowKey = toUtcDateKey(windowStart);
    const sparkline = dailySeries(byDay, windowStart, now);
    const current = avgWhere(byDay, (k) => k >= windowKey);
    const previous = avgWhere(byDay, (k) => k < windowKey);
    return { current, previous, sparkline };
  }
}

function mapDailyRows(rows: DailyRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.day, Number(r.value) || 0);
  return out;
}

function dailySeries(byDay: Map<string, number>, from: Date, to: Date): number[] {
  const out: number[] = [];
  const cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor.getTime() <= end.getTime()) {
    const key = toUtcDateKey(cursor);
    out.push(byDay.get(key) ?? 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function sumWhere(byDay: Map<string, number>, pred: (key: string) => boolean): number {
  let total = 0;
  for (const [key, value] of byDay) {
    if (pred(key)) total += value;
  }
  return total;
}

function avgWhere(byDay: Map<string, number>, pred: (key: string) => boolean): number {
  let sum = 0;
  let n = 0;
  for (const [key, value] of byDay) {
    if (!pred(key)) continue;
    sum += value;
    n += 1;
  }
  return n === 0 ? 0 : Math.round(sum / n);
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function toUtcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clampDays(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 90);
}
