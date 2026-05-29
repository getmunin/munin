import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { assertOwnerOrAdmin } from './role-guard.ts';

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

@Controller('v1/tokens')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class TokensController {
  @Get()
  async list(): Promise<TokenDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
    const rows = await ctx.db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.orgId, actor.orgId))
      .orderBy(desc(schema.tokens.createdAt));
    return rows.map(toDto);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id') id: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
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
