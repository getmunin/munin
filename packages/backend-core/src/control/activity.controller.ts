import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';

interface ActivityDto {
  id: string;
  type: string;
  actorId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface Cursor {
  createdAt: string;
  id: string;
}

@Controller('api/v1/activity')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class ActivityController {
  @Get()
  async list(
    @Query('types') types?: string,
    @Query('actorId') actorId?: string,
    @Query('conversationId') conversationId?: string,
    @Query('contactId') contactId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: ActivityDto[]; nextCursor: string | null }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const take = clampLimit(limit, 50, 200);

    const filters: SQL[] = [eq(schema.events.orgId, actor.orgId)];

    if (types) {
      const parsed = types.split(',').map((s) => s.trim()).filter(Boolean);
      if (parsed.length > 0) filters.push(inArray(schema.events.type, parsed));
    }
    if (actorId) filters.push(eq(schema.events.actorId, actorId));
    if (conversationId) {
      filters.push(sql`${schema.events.payload}->>'conversationId' = ${conversationId}`);
    }
    if (contactId) {
      const convs = await ctx.db
        .select({ id: schema.convConversations.id })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.contactId, contactId));
      const ids = convs.map((c) => c.id);
      if (ids.length === 0) return { items: [], nextCursor: null };
      filters.push(sql`${schema.events.payload}->>'conversationId' = ANY(${ids})`);
    }
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        filters.push(
          or(
            lt(schema.events.createdAt, new Date(decoded.createdAt)),
            and(
              eq(schema.events.createdAt, new Date(decoded.createdAt)),
              lt(schema.events.id, decoded.id),
            ),
          )!,
        );
      }
    }

    const rows = await ctx.db
      .select()
      .from(schema.events)
      .where(and(...filters))
      .orderBy(desc(schema.events.createdAt), desc(schema.events.id))
      .limit(take + 1);

    const items = rows.slice(0, take).map(toDto);
    const nextCursor =
      rows.length > take && items.length > 0
        ? encodeCursor({
            createdAt: items[items.length - 1]!.createdAt,
            id: items[items.length - 1]!.id,
          })
        : null;
    return { items, nextCursor };
  }
}

function toDto(row: typeof schema.events.$inferSelect): ActivityDto {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actorId,
    correlationId: row.correlationId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as { createdAt?: unknown; id?: unknown };
    if (typeof candidate.createdAt !== 'string' || typeof candidate.id !== 'string') return null;
    return { createdAt: candidate.createdAt, id: candidate.id };
  } catch {
    return null;
  }
}
