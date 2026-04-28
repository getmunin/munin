import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@munin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { PartnersService } from './partners.service.js';

const PatchDto = z.object({
  name: z.string().min(1).max(128).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

interface OrgDto {
  id: string;
  name: string;
  slug: string;
  partnerId: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
}

@Controller('api/orgs/me')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OrgsController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}

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
      partnerId: row.partnerId,
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
      partnerId: updated!.partnerId,
      settings: updated!.settings,
      createdAt: updated!.createdAt.toISOString(),
    };
  }

  /**
   * Customer-side revocation of partner access. Severs the Org.partner_id
   * pointer and revokes every admin key the partner provisioned. The
   * customer keeps their data + their direct-claimed dashboard password.
   */
  @Delete('partner-access')
  async revokePartner(): Promise<{ revoked: true }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    return this.partners.revokePartnerAccess(actor.orgId);
  }
}
