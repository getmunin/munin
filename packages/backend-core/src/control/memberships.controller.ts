import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';

const ActiveDto = z.object({
  orgId: z.string().min(1),
});

interface MembershipDto {
  orgId: string;
  name: string;
  slug: string;
  role: string;
  isDefault: boolean;
}

/**
 * Cross-org listing + switching for the *current user* (session cookie auth).
 *
 * `GET /api/orgs/me/memberships` returns every org the caller is a member
 * of; `PATCH /api/orgs/me/memberships/active` flips `is_default` so the
 * session-cookie credential resolver picks that org on the next request.
 *
 * Bypasses RLS for these reads/writes because we need to span orgs; the
 * scope is hard-filtered by `actor.userId` so the caller can only see/touch
 * their own memberships.
 */
@Controller('api/orgs/me/memberships')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class MembershipsController {
  @Get()
  async list(): Promise<MembershipDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'user' || !actor.userId) {
      throw new ForbiddenException('user session required');
    }

    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);

    const rows = await ctx.db
      .select({
        orgId: schema.orgs.id,
        name: schema.orgs.name,
        slug: schema.orgs.slug,
        role: schema.orgMembers.role,
        isDefault: schema.orgMembers.isDefault,
        createdAt: schema.orgMembers.createdAt,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
      .where(eq(schema.orgMembers.userId, actor.userId))
      .orderBy(asc(schema.orgMembers.createdAt));

    return rows.map((r) => ({
      orgId: r.orgId,
      name: r.name,
      slug: r.slug,
      role: r.role,
      isDefault: r.isDefault,
    }));
  }

  @Patch('active')
  async setActive(@Body() body: unknown): Promise<{ active: string }> {
    const parsed = ActiveDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'user' || !actor.userId) {
      throw new ForbiddenException('user session required');
    }

    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);

    const membership = await ctx.db
      .select()
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.userId, actor.userId),
          eq(schema.orgMembers.orgId, parsed.data.orgId),
        ),
      )
      .limit(1);
    if (!membership[0]) {
      throw new NotFoundException('you are not a member of that org');
    }

    await ctx.db
      .update(schema.orgMembers)
      .set({ isDefault: false })
      .where(eq(schema.orgMembers.userId, actor.userId));
    await ctx.db
      .update(schema.orgMembers)
      .set({ isDefault: true })
      .where(
        and(
          eq(schema.orgMembers.userId, actor.userId),
          eq(schema.orgMembers.orgId, parsed.data.orgId),
        ),
      );

    return { active: parsed.data.orgId };
  }
}
