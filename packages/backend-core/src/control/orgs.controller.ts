import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

class PatchOrgBody extends createZodDto(
  z.object({
    name: z.string().min(1).max(128).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
) {}

interface OrgDto {
  id: string;
  name: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

@Controller('v1/orgs/me')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OrgsController {
  @Get()
  async me(): Promise<OrgDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, actor.orgId))
      .limit(1);
    const row = rows[0]!;
    return {
      id: row.id,
      name: row.name,
      settings: row.settings,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Patch()
  @RequireRole('owner', 'admin')
  async update(@Body() input: PatchOrgBody): Promise<OrgDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [updated] = await ctx.db
      .update(schema.orgs)
      .set({
        ...(input.name && { name: input.name }),
        ...(input.settings && { settings: input.settings }),
        updatedAt: new Date(),
      })
      .where(eq(schema.orgs.id, actor.orgId))
      .returning();
    return {
      id: updated!.id,
      name: updated!.name,
      settings: updated!.settings,
      createdAt: updated!.createdAt.toISOString(),
    };
  }
}
