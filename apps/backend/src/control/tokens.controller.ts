import {
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { schema } from '@munin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';

@Controller('api/tokens')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class TokensController {
  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@Param('id') id: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = await ctx.db
      .update(schema.tokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.tokens.id, id), eq(schema.tokens.orgId, actor.orgId)))
      .returning({ id: schema.tokens.id });
    if (result.length === 0) throw new NotFoundException(`token ${id} not found`);
  }
}
