import { Controller, Get, Inject, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { inArray, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AGENT_HOST_ACTOR, AGENT_HOST_ACTOR_PREFIX } from '@getmunin/types';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

export interface UsageSummaryTile {
  current: number;
  previous: number;
  sparkline: number[];
}

export interface UsageSummaryDto {
  mcpCalls: UsageSummaryTile & { period: 'month' };
  apiCalls: UsageSummaryTile & { period: 'month' };
  aiTokens: UsageSummaryTile & { period: 'month' };
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
  actor_type: string;
  actor_id: string | null;
  client_id: string | null;
  call_count: number;
  total_ms: number | null;
  timed_count: number;
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
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class UsageController {
  constructor(@Inject(RateLimitService) private readonly rateLimit: RateLimitService) {}

  @Get()
  async current() {
    return this.rateLimit.usage();
  }

  @Get('summary')
  async summary(): Promise<UsageSummaryDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const orgId = actor.orgId;

    const now = new Date();
    const monthStart = startOfMonth(now);
    const prevMonthStart = startOfMonth(addMonths(monthStart, -1));
    const sevenAgo = addDays(startOfDay(now), -6);
    const fourteenAgo = addDays(startOfDay(now), -13);

    const monthSparkStart = addDays(startOfDay(now), -29);

    const [mcp, api, aiTokens, conv, lat] = await Promise.all([
      this.mcpCallsTile(orgId, monthStart, prevMonthStart, monthSparkStart, now),
      this.apiCallsTile(orgId, monthStart, prevMonthStart, monthSparkStart, now),
      this.dailyCounterTile(orgId, 'ai_tokens_day', monthStart, prevMonthStart, monthSparkStart, now),
      this.conversationsTile(orgId, monthStart, prevMonthStart, monthSparkStart, now),
      this.latencyTile(orgId, sevenAgo, fourteenAgo, now),
    ]);

    return {
      mcpCalls: { ...mcp, period: 'month' },
      apiCalls: { ...api, period: 'month' },
      aiTokens: { ...aiTokens, period: 'month' },
      conversations: { ...conv, period: 'month' },
      avgLatencyMs: { ...lat, period: '7d' },
    };
  }

  @Get('by-agent')
  async byAgent(@Query('days') daysRaw?: string): Promise<UsageByAgentDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const orgId = actor.orgId;

    const days = clampDays(daysRaw, 30);
    const since = addDays(startOfDay(new Date()), -(days - 1));

    const rows = await ctx.db.execute<AgentAggRow>(sql`
      SELECT actor_type,
             actor_id,
             client_id,
             count(*)::int AS call_count,
             sum(duration_ms)::float8 AS total_ms,
             count(duration_ms)::int AS timed_count
      FROM audit_log
      WHERE org_id = ${orgId}
        AND tool IS NOT NULL
        AND actor_type <> 'system'
        AND created_at >= ${since.toISOString()}::timestamptz
      GROUP BY actor_type, actor_id, client_id
    `);

    const labels = await resolveAgentLabels(rows);

    const merged = new Map<string, { dto: AgentUsageDto; totalMs: number; timed: number }>();
    for (const row of rows) {
      const label = labels(row);
      const existing = merged.get(label.key);
      const entry = existing ?? {
        dto: {
          id: label.key,
          name: label.name,
          description: label.description,
          mcpCalls: 0,
          avgLatencyMs: null,
        },
        totalMs: 0,
        timed: 0,
      };
      entry.dto.mcpCalls += Number(row.call_count) || 0;
      entry.totalMs += Number(row.total_ms) || 0;
      entry.timed += Number(row.timed_count) || 0;
      if (!existing) merged.set(label.key, entry);
    }

    const items: AgentUsageDto[] = [...merged.values()]
      .map(({ dto, totalMs, timed }) => ({
        ...dto,
        avgLatencyMs: timed === 0 ? null : Math.round(totalMs / timed),
      }))
      .sort((a, b) => b.mcpCalls - a.mcpCalls || a.name.localeCompare(b.name));

    return { rangeDays: days, agents: items };
  }

  private mcpCallsTile(
    orgId: string,
    monthStart: Date,
    prevMonthStart: Date,
    sparkStart: Date,
    now: Date,
  ): Promise<UsageSummaryTile> {
    return this.dailyCounterTile(orgId, 'mcp_calls_day', monthStart, prevMonthStart, sparkStart, now);
  }

  private apiCallsTile(
    orgId: string,
    monthStart: Date,
    prevMonthStart: Date,
    sparkStart: Date,
    now: Date,
  ): Promise<UsageSummaryTile> {
    return this.dailyCounterTile(orgId, 'api_calls_day', monthStart, prevMonthStart, sparkStart, now);
  }

  private async dailyCounterTile(
    orgId: string,
    bucket: string,
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
        AND bucket = ${bucket}
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

interface AgentLabel {
  key: string;
  name: string;
  description: string | null;
}

async function resolveAgentLabels(
  rows: AgentAggRow[],
): Promise<(row: AgentAggRow) => AgentLabel> {
  const ctx = getCurrentContext();
  const clientIds = distinct(rows.map((r) => r.client_id));
  const actorIds = distinct(rows.map((r) => r.actor_id));

  const clientNames = new Map<string, string>();
  if (clientIds.length > 0) {
    const found = await ctx.db
      .select({ clientId: schema.oauthClient.clientId, name: schema.oauthClient.name })
      .from(schema.oauthClient)
      .where(inArray(schema.oauthClient.clientId, clientIds));
    for (const row of found) {
      if (row.name) clientNames.set(row.clientId, row.name);
    }
  }

  const userLabels = new Map<string, string>();
  if (actorIds.length > 0) {
    const found = await ctx.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, actorIds));
    for (const row of found) userLabels.set(row.id, row.name ?? row.email);
  }

  const keyNames = new Map<string, string>();
  const keyIds = actorIds.filter((id) => id.startsWith('akey_'));
  if (keyIds.length > 0) {
    const found = await ctx.db
      .select({ id: schema.apiKeys.id, name: schema.apiKeys.name })
      .from(schema.apiKeys)
      .where(inArray(schema.apiKeys.id, keyIds));
    for (const row of found) keyNames.set(row.id, row.name);
  }

  const endUserByToken = new Map<string, string>();
  const tokenIds = actorIds.filter((id) => id.startsWith('tok_'));
  if (tokenIds.length > 0) {
    const found = await ctx.db
      .select({ tokenId: schema.tokens.id, endUserId: schema.tokens.endUserId })
      .from(schema.tokens)
      .where(inArray(schema.tokens.id, tokenIds));
    for (const row of found) {
      if (row.endUserId) endUserByToken.set(row.tokenId, row.endUserId);
    }
  }

  const endUserIds = distinct([
    ...endUserByToken.values(),
    ...actorIds.map((id) => agentHostEndUserId(id)),
  ]);
  const endUserLabels = new Map<string, string>();
  if (endUserIds.length > 0) {
    const found = await ctx.db
      .select({ id: schema.endUsers.id, name: schema.endUsers.name, email: schema.endUsers.email })
      .from(schema.endUsers)
      .where(inArray(schema.endUsers.id, endUserIds));
    for (const row of found) endUserLabels.set(row.id, row.name ?? row.email ?? row.id);
  }

  const endUserLabel = (endUserId: string): AgentLabel => ({
    key: `end_user:${endUserId}`,
    name: endUserLabels.get(endUserId) ?? endUserId,
    description: 'end_user_agent',
  });

  return (row) => {
    const actorId = row.actor_id;
    if (row.client_id) {
      const name = clientNames.get(row.client_id) ?? row.client_id;
      return {
        key: `oauth:${name}:${actorId ?? ''}`,
        name,
        description: actorId ? (userLabels.get(actorId) ?? null) : null,
      };
    }
    if (!actorId) {
      return { key: `type:${row.actor_type}`, name: row.actor_type, description: null };
    }
    const keyName = keyNames.get(actorId);
    if (keyName) {
      return { key: `key:${actorId}`, name: keyName, description: row.actor_type };
    }
    const tokenEndUserId = endUserByToken.get(actorId);
    if (tokenEndUserId) return endUserLabel(tokenEndUserId);

    const hostEndUserId = agentHostEndUserId(actorId);
    if (hostEndUserId) return endUserLabel(hostEndUserId);

    const userLabel = userLabels.get(actorId);
    if (userLabel) {
      return { key: `user:${actorId}`, name: userLabel, description: row.actor_type };
    }
    if (actorId.startsWith(AGENT_HOST_ACTOR_PREFIX)) {
      return { key: AGENT_HOST_ACTOR, name: AGENT_HOST_ACTOR, description: row.actor_type };
    }
    return { key: `actor:${actorId}`, name: actorId, description: row.actor_type };
  };
}

function agentHostEndUserId(actorId: string | null): string | null {
  if (!actorId?.startsWith(AGENT_HOST_ACTOR_PREFIX)) return null;
  const parts = actorId.split(':');
  return parts.length === 3 ? (parts[2] ?? null) : null;
}

function distinct(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v !== null && v !== ''))];
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
