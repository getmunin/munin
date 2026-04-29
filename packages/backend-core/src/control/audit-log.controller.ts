import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@munin/db';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';

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
  createdAt: string;
}

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
  ): Promise<{ items: AuditDto[]; nextCursor: string | null }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const take = clampLimit(limit, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);

    const filters: SQL[] = [eq(schema.auditLog.orgId, actor.orgId)];
    if (tool) filters.push(eq(schema.auditLog.tool, tool));
    if (actorType) filters.push(eq(schema.auditLog.actorType, actorType));
    if (correlationId) filters.push(eq(schema.auditLog.correlationId, correlationId));
    if (before) filters.push(lt(schema.auditLog.createdAt, new Date(before)));

    const rows = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(...filters))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(take + 1);

    const items = rows.slice(0, take).map(toDto);
    const nextCursor = rows.length > take ? items[items.length - 1]!.createdAt : null;
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
    createdAt: row.createdAt.toISOString(),
  };
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
