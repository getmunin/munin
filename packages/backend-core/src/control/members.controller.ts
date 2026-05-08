import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, asc, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { assertOwner, assertOwnerOrAdmin } from './role-guard.js';

const PatchMemberDto = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});

interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isDefault: boolean;
  joinedAt: string;
}

@Controller('api/v1/orgs/me/members')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class MembersController {
  @Get()
  async list(): Promise<MemberDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
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
  async patch(@Param('userId') userId: string, @Body() body: unknown): Promise<MemberDto> {
    const parsed = PatchMemberDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwner(actor.orgId, actor.userId ?? actor.id);

    // Prevent demoting the last owner.
    if (parsed.data.role !== 'owner') {
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
      .set({ role: parsed.data.role })
      .where(
        and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.orgMembers.userId, userId)),
      )
      .returning();
    if (result.length === 0) throw new NotFoundException(`member ${userId} not found in this org`);

    const dto = await this.list();
    const found = dto.find((m) => m.userId === userId);
    if (!found) throw new NotFoundException(`member ${userId} not found`);
    return found;
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(@Param('userId') userId: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwner(actor.orgId, actor.userId ?? actor.id);

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
