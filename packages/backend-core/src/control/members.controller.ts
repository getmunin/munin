import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, asc, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { assertOwner, assertOwnerOrAdmin } from './role-guard.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

class PatchMemberBody extends createZodDto(
  z
    .object({
      role: z.enum(['owner', 'admin', 'member']).optional(),
      name: z.string().min(1).max(128).optional(),
    })
    .refine((data) => data.role !== undefined || data.name !== undefined, {
      message: 'at least one of role or name must be provided',
    }),
) {}

interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isDefault: boolean;
  joinedAt: string;
}

@Controller('v1/orgs/me/members')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class MembersController {
  @Get()
  @RequireRole('owner', 'admin')
  async list(): Promise<MemberDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({
        userId: schema.orgMembers.userId,
        role: schema.orgMembers.role,
        isDefault: schema.orgMembers.isDefault,
        joinedAt: schema.orgMembers.createdAt,
        email: schema.users.email,
        name: schema.users.name,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .where(eq(schema.orgMembers.orgId, actor.orgId))
      .orderBy(asc(schema.orgMembers.createdAt));
    return rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      name: r.name,
      role: r.role,
      isDefault: r.isDefault,
      joinedAt: r.joinedAt.toISOString(),
    }));
  }

  @Patch(':userId')
  async patch(
    @Param('userId') userId: string,
    @Body() input: PatchMemberBody,
  ): Promise<MemberDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const actorId = actor.userId ?? actor.id;

    if (input.role !== undefined) {
      await assertOwner(actor.orgId, actorId);

      if (input.role !== 'owner') {
        const owners = await ctx.db
          .select({ userId: schema.orgMembers.userId })
          .from(schema.orgMembers)
          .where(
            and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.orgMembers.role, 'owner')),
          );
        const lastOwnerIsTarget =
          owners.length === 1 && owners[0]?.userId === userId;
        if (lastOwnerIsTarget) {
          throw new ConflictException('cannot demote the last owner');
        }
      }

      const result = await ctx.db
        .update(schema.orgMembers)
        .set({ role: input.role })
        .where(
          and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.orgMembers.userId, userId)),
        )
        .returning();
      if (result.length === 0)
        throw new NotFoundException(`member ${userId} not found in this org`);
    }

    if (input.name !== undefined) {
      if (actor.type !== 'user') {
        throw new ForbiddenException('API keys cannot edit member names');
      }
      if (userId !== actorId) {
        await assertOwnerOrAdmin(actor.orgId, actorId);
      }
      const targetExists = await ctx.db
        .select({ userId: schema.orgMembers.userId })
        .from(schema.orgMembers)
        .where(
          and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.orgMembers.userId, userId)),
        )
        .limit(1);
      if (!targetExists[0])
        throw new NotFoundException(`member ${userId} not found in this org`);

      await ctx.db
        .update(schema.users)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    }

    const dto = await this.list();
    const found = dto.find((m) => m.userId === userId);
    if (!found) throw new NotFoundException(`member ${userId} not found`);
    return found;
  }

  @Delete(':userId')
  @HttpCode(204)
  @RequireRole('owner')
  async remove(@Param('userId') userId: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const target = await ctx.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.orgMembers.userId, userId)),
      )
      .limit(1);
    if (!target[0]) throw new NotFoundException(`member ${userId} not found in this org`);

    if (target[0].role === 'owner') {
      const owners = await ctx.db
        .select({ userId: schema.orgMembers.userId })
        .from(schema.orgMembers)
        .where(
          and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.orgMembers.role, 'owner')),
        );
      if (owners.length <= 1) {
        throw new ConflictException('cannot remove the last owner');
      }
    }

    await ctx.db
      .delete(schema.orgMembers)
      .where(
        and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.orgMembers.userId, userId)),
      );
  }
}
