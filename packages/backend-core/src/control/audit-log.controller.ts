import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

interface AuditDto {
  id: string;
  actorType: string;
  actorId: string | null;
  tool: string | null;
  method: string | null;
  target: { type: string; id: string } | null;
  result: string | null;
  error: string | null;
  correlationId: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  userAgent: string | null;
  origin: string | null;
  client: ClientKind;
  clientName: string | null;
  clientIconUrl: string | null;
  createdAt: string;
}

interface ClientMeta {
  name: string | null;
  icon: string | null;
}

export type ClientKind =
  | 'sdk'
  | 'cli'
  | 'mcp'
  | 'dashboard'
  | 'browser'
  | 'widget'
  | 'unknown';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

@Controller('v1/audit-logs')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class AuditLogController {
  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('tool') tool?: string,
    @Query('actorType') actorType?: string,
    @Query('correlationId') correlationId?: string,
    @Query('client') client?: string,
  ): Promise<{ items: AuditDto[]; nextCursor: string | null }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const take = clampLimit(limit, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);

    const filters: SQL[] = [eq(schema.auditLog.orgId, actor.orgId)];
    if (tool) filters.push(eq(schema.auditLog.tool, tool));
    if (actorType) filters.push(eq(schema.auditLog.actorType, actorType));
    if (correlationId) filters.push(eq(schema.auditLog.correlationId, correlationId));
    if (before) filters.push(lt(schema.auditLog.createdAt, new Date(before)));

    const fetchTake = client ? Math.max(take * 4, 200) : take + 1;
    const rows = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(...filters))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(fetchTake);

    const clients = await readClientMeta(rows);
    const all = rows.map((row) => toDto(row, clients));
    const filtered = client ? all.filter((r) => r.client === client) : all;
    const items = filtered.slice(0, take);
    const nextCursor = filtered.length > take ? items[items.length - 1]!.createdAt : null;
    return { items, nextCursor };
  }
}

async function readClientMeta(
  rows: Array<typeof schema.auditLog.$inferSelect>,
): Promise<Map<string, ClientMeta>> {
  const ids = [...new Set(rows.map((r) => r.clientId).filter((v): v is string => !!v))];
  const out = new Map<string, ClientMeta>();
  if (ids.length === 0) return out;
  const found = await getCurrentContext()
    .db.select({
      clientId: schema.oauthClient.clientId,
      name: schema.oauthClient.name,
      icon: schema.oauthClient.icon,
    })
    .from(schema.oauthClient)
    .where(inArray(schema.oauthClient.clientId, ids));
  for (const row of found) {
    out.set(row.clientId, { name: row.name ?? null, icon: row.icon ?? null });
  }
  return out;
}

function toDto(
  row: typeof schema.auditLog.$inferSelect,
  clients: Map<string, ClientMeta>,
): AuditDto {
  const client = row.clientId ? (clients.get(row.clientId) ?? null) : null;
  return {
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId,
    tool: row.tool,
    method: row.method,
    target: row.target,
    result: row.result,
    error: row.error,
    correlationId: row.correlationId,
    durationMs: row.durationMs,
    totalTokens: row.totalTokens,
    userAgent: row.userAgent,
    origin: row.origin,
    client: classifyClient(row),
    clientName: client?.name ?? null,
    clientIconUrl: client?.icon ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ClientSignals {
  userAgent: string | null;
  tool: string | null;
  method: string | null;
  actorType: string;
  clientId: string | null;
}

export function classifyClient(signals: ClientSignals): ClientKind {
  if (signals.tool) return 'mcp';
  if (isMcpTransport(signals.method)) return 'mcp';
  if (signals.actorType === 'widget_agent') return 'widget';
  const ua = signals.userAgent?.toLowerCase();
  if (!ua) return 'unknown';
  if (ua.includes('@getmunin/agent-runtime') || ua.includes('@getmunin/sdk') || ua.includes('munin')) {
    return 'sdk';
  }
  if (ua.includes('curl') || ua.includes('wget') || ua.includes('httpie') || ua.includes('postman') || ua.includes('insomnia')) {
    return 'cli';
  }
  if (!ua.startsWith('mozilla/')) return 'unknown';
  return isDashboardSession(signals) ? 'dashboard' : 'browser';
}

function isDashboardSession(signals: ClientSignals): boolean {
  return signals.actorType === 'user' && !signals.clientId;
}

function isMcpTransport(method: string | null): boolean {
  if (!method) return false;
  const path = method.split(' ')[1];
  return path === '/mcp' || (path?.startsWith('/mcp/') ?? false);
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
