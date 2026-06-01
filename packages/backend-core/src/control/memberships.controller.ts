import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';

class SetActiveBody extends createZodDto(
  z.object({
    orgId: z.string().min(1),
  }),
) {}

interface MembershipDto {
  orgId: string;
  name: string;
  role: string;
  isDefault: boolean;
}

@Controller('v1/me/memberships')
@UseGuards(AuthGuard, ControlPlaneGuard)
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
      role: r.role,
      isDefault: r.isDefault,
    }));
  }

  @Patch('active')
  async setActive(@Body() input: SetActiveBody): Promise<{ active: string }> {
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
          eq(schema.orgMembers.orgId, input.orgId),
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
          eq(schema.orgMembers.orgId, input.orgId),
        ),
      );

    return { active: input.orgId };
  }
}
