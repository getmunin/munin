import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
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
import { readBody } from '../common/storage/read-body.ts';
import { ORG_LOGO_MAX_BYTES, OrgLogoService, orgLogoTooLarge } from './org-logo.service.ts';

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
  logoUrl: string | null;
  createdAt: string;
}

@Controller('v1/orgs/me')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OrgsController {
  constructor(private readonly logos: OrgLogoService) {}

  @Get()
  async me(): Promise<OrgDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, actor.orgId))
      .limit(1);
    return this.toDto(rows[0]!);
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
    return this.toDto(updated!);
  }

  @Put('logo')
  @RequireRole('owner', 'admin')
  async uploadLogo(@Req() req: Request): Promise<OrgDto> {
    const bytes = await readBody(req, ORG_LOGO_MAX_BYTES, orgLogoTooLarge);
    return this.toDto(await this.logos.upload(req.headers['content-type'], bytes));
  }

  @Delete('logo')
  @RequireRole('owner', 'admin')
  async removeLogo(): Promise<OrgDto> {
    return this.toDto(await this.logos.remove());
  }

  private toDto(row: typeof schema.orgs.$inferSelect): OrgDto {
    return {
      id: row.id,
      name: row.name,
      settings: row.settings,
      logoUrl: this.logos.logoUrl(row),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
