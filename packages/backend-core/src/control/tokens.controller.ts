import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { schema } from '@munin/db';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';

interface TokenDto {
  id: string;
  type: string;
  scopes: string[];
  audiences: string[];
  endUserId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

@Controller('api/tokens')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class TokensController {
  /** List all tokens issued for the calling org — surfaced as "Connected agents" in the dashboard. */
  @Get()
  async list(): Promise<TokenDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.orgId, actor.orgId))
      .orderBy(desc(schema.tokens.createdAt));
    return rows.map(toDto);
  }

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

function toDto(row: typeof schema.tokens.$inferSelect): TokenDto {
  return {
    id: row.id,
    type: row.type,
    scopes: row.scopes,
    audiences: row.audiences,
    endUserId: row.endUserId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
