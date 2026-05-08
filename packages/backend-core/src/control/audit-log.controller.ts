import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { assertOwnerOrAdmin } from './role-guard.js';

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
  userAgent: string | null;
  client: ClientKind;
  createdAt: string;
}

type ClientKind = 'sdk' | 'cli' | 'mcp' | 'unknown';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

@Controller('api/audit-log')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class AuditLogController {
  /**
   * Newest-first cursor pagination. `before` is the createdAt of the last
   * item from the previous page (ISO string); omit for the first page.
   * Optional filters: tool, actorType, correlationId.
   */
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
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
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

    const all = rows.map(toDto);
    const filtered = client ? all.filter((r) => r.client === client) : all;
    const items = filtered.slice(0, take);
    const nextCursor = filtered.length > take ? items[items.length - 1]!.createdAt : null;
    return { items, nextCursor };
  }
}

function toDto(row: typeof schema.auditLog.$inferSelect): AuditDto {
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
    userAgent: row.userAgent,
    client: classifyClient(row.userAgent, row.tool),
    createdAt: row.createdAt.toISOString(),
  };
}

function classifyClient(userAgent: string | null, tool: string | null): ClientKind {
  if (tool) return 'mcp';
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (ua.includes('@getmunin/agent-runtime') || ua.includes('@getmunin/sdk') || ua.includes('munin')) {
    return 'sdk';
  }
  if (ua.includes('curl') || ua.includes('wget') || ua.includes('httpie') || ua.includes('postman') || ua.includes('insomnia')) {
    return 'cli';
  }
  return 'unknown';
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
