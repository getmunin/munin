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
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

interface TokenDto {
  id: string;
  type: string;
  scopes: string[];
  audiences: string[];
  origin: string | null;
  endUserId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

@Controller('v1/tokens')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class TokensController {
  @Get()
  async list(): Promise<TokenDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [issued, oauth] = await Promise.all([
      ctx.db
        .select()
        .from(schema.tokens)
        .where(eq(schema.tokens.orgId, actor.orgId))
        .orderBy(desc(schema.tokens.createdAt)),
      listOauthAgents(ctx.db),
    ]);
    return [...issued.map(toDto), ...oauth].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id') id: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (id.startsWith('oat_')) {
      await revokeOauthAgent(ctx.db, id);
      return;
    }
    const result = await ctx.db
      .update(schema.tokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.tokens.id, id), eq(schema.tokens.orgId, actor.orgId)))
      .returning({ id: schema.tokens.id });
    if (result.length === 0) throw new NotFoundException(`token ${id} not found`);
  }
}

/**
 * OAuth-authorized agents (Claude Code, Cursor, …) don't get rows in `tokens` —
 * BetterAuth persists their access/refresh tokens in the `oauth_*` tables. Surface
 * them as one row per (client, user) so they show up in the flock alongside
 * delegated tokens.
 */
async function listOauthAgents(db: Db | Tx): Promise<TokenDto[]> {
  const rows = await db
    .select({
      id: schema.oauthAccessToken.id,
      clientId: schema.oauthAccessToken.clientId,
      userId: schema.oauthAccessToken.userId,
      scopes: schema.oauthAccessToken.scopes,
      expiresAt: schema.oauthAccessToken.expiresAt,
      createdAt: schema.oauthAccessToken.createdAt,
      clientName: schema.oauthClient.name,
    })
    .from(schema.oauthAccessToken)
    // org_members is RLS-scoped to the caller's org, so this join is the tenant
    // filter: only tokens whose user belongs to the current org survive.
    .innerJoin(
      schema.orgMembers,
      eq(schema.orgMembers.userId, schema.oauthAccessToken.userId),
    )
    .leftJoin(
      schema.oauthClient,
      eq(schema.oauthClient.clientId, schema.oauthAccessToken.clientId),
    )
    .where(gt(schema.oauthAccessToken.expiresAt, new Date()))
    .orderBy(desc(schema.oauthAccessToken.createdAt));

  const seen = new Set<string>();
  const dtos: TokenDto[] = [];
  for (const row of rows) {
    const key = `${row.clientId}:${row.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dtos.push({
      id: row.id,
      type: 'oauth_access',
      scopes: row.scopes,
      audiences: [],
      origin: row.clientName ?? row.clientId,
      endUserId: null,
      expiresAt: row.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return dtos;
}

async function revokeOauthAgent(db: Db | Tx, accessTokenId: string): Promise<void> {
  const rows = await db
    .select({
      clientId: schema.oauthAccessToken.clientId,
      userId: schema.oauthAccessToken.userId,
    })
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.id, accessTokenId))
    .limit(1);
  const row = rows[0];
  if (!row?.userId) throw new NotFoundException(`token ${accessTokenId} not found`);

  // A hit in the RLS-scoped org_members proves the user belongs to the caller's
  // org — blocks revoking an agent that lives in another tenant.
  const membership = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.userId, row.userId))
    .limit(1);
  if (membership.length === 0) throw new NotFoundException(`token ${accessTokenId} not found`);

  // Drop access and refresh tokens together so the agent can't silently refresh
  // back in after the access token is gone.
  await db
    .delete(schema.oauthAccessToken)
    .where(
      and(
        eq(schema.oauthAccessToken.clientId, row.clientId),
        eq(schema.oauthAccessToken.userId, row.userId),
      ),
    );
  await db
    .delete(schema.oauthRefreshToken)
    .where(
      and(
        eq(schema.oauthRefreshToken.clientId, row.clientId),
        eq(schema.oauthRefreshToken.userId, row.userId),
      ),
    );
}

function toDto(row: typeof schema.tokens.$inferSelect): TokenDto {
  return {
    id: row.id,
    type: row.type,
    scopes: row.scopes,
    audiences: row.audiences,
    origin: null,
    endUserId: row.endUserId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
