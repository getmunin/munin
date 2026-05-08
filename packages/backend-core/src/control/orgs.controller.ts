import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';

const PatchDto = z.object({
  name: z.string().min(1).max(128).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

interface OrgDto {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

@Controller('api/v1/orgs/me')
@UseGuards(AuthGuard)
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
      slug: row.slug,
      settings: row.settings,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Patch()
  async update(@Body() body: unknown): Promise<OrgDto> {
    const parsed = PatchDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [updated] = await ctx.db
      .update(schema.orgs)
      .set({
        ...(parsed.data.name && { name: parsed.data.name }),
        ...(parsed.data.settings && { settings: parsed.data.settings }),
        updatedAt: new Date(),
      })
      .where(eq(schema.orgs.id, actor.orgId))
      .returning();
    return {
      id: updated!.id,
      name: updated!.name,
      slug: updated!.slug,
      settings: updated!.settings,
      createdAt: updated!.createdAt.toISOString(),
    };
  }
}
