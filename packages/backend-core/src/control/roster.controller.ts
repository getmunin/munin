import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';

interface RosterMemberDto {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  activeClaimCount: number;
}

interface RosterResponse {
  members: RosterMemberDto[];
  viewer: { userId: string; role: string } | null;
}

@Controller('v1/orgs/me')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class RosterController {
  @Get('roster')
  async roster(): Promise<RosterResponse> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({
        userId: schema.orgMembers.userId,
        role: schema.orgMembers.role,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .where(eq(schema.orgMembers.orgId, actor.orgId))
      .orderBy(asc(schema.orgMembers.createdAt));

    const counts = await ctx.db
      .select({
        userId: schema.claims.userId,
        activeClaimCount: sql<number>`count(*)::int`,
      })
      .from(schema.claims)
      .where(
        and(
          eq(schema.claims.entityType, 'conversation'),
          sql`${schema.claims.expiresAt} > now()`,
        ),
      )
      .groupBy(schema.claims.userId);
    const countByUser = new Map(counts.map((c) => [c.userId, c.activeClaimCount]));

    const viewerUserId = actor.type === 'user' ? (actor.userId ?? actor.id) : null;
    const viewerRow = viewerUserId ? rows.find((r) => r.userId === viewerUserId) : undefined;
    return {
      members: rows.map((r) => ({
        userId: r.userId,
        name: r.name,
        email: r.email,
        role: r.role,
        activeClaimCount: countByUser.get(r.userId) ?? 0,
      })),
      viewer: viewerRow ? { userId: viewerRow.userId, role: viewerRow.role } : null,
    };
  }
}
