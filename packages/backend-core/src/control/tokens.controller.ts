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
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
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
  count: number;
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
    if (id.startsWith('orft_')) {
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
 * BetterAuth persists their grants in the `oauth_*` tables. Their access tokens
 * are stateless JWTs (no DB row), so the durable record of a connected agent is
 * the *refresh* token. MCP dynamic client registration also mints a fresh
 * `client_id` on every connect, so one user reconnecting Claude piles up many
 * refresh tokens — we collapse them to one row per (client name, user).
 */
async function listOauthAgents(db: Db | Tx): Promise<TokenDto[]> {
  const rows = await db
    .select({
      id: schema.oauthRefreshToken.id,
      clientId: schema.oauthRefreshToken.clientId,
      userId: schema.oauthRefreshToken.userId,
      scopes: schema.oauthRefreshToken.scopes,
      expiresAt: schema.oauthRefreshToken.expiresAt,
      createdAt: schema.oauthRefreshToken.createdAt,
      clientName: schema.oauthClient.name,
    })
    .from(schema.oauthRefreshToken)
    .innerJoin(
      schema.orgMembers,
      eq(schema.orgMembers.userId, schema.oauthRefreshToken.userId),
    )
    .leftJoin(
      schema.oauthClient,
      eq(schema.oauthClient.clientId, schema.oauthRefreshToken.clientId),
    )
    .where(
      and(
        gt(schema.oauthRefreshToken.expiresAt, new Date()),
        isNull(schema.oauthRefreshToken.revoked),
      ),
    )
    .orderBy(desc(schema.oauthRefreshToken.createdAt));

  const groups = new Map<string, TokenDto>();
  for (const row of rows) {
    const origin = row.clientName ?? row.clientId;
    const key = `${origin}:${row.userId}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        id: row.id,
        type: 'oauth_refresh',
        scopes: row.scopes,
        audiences: [],
        origin,
        endUserId: null,
        expiresAt: row.expiresAt.toISOString(),
        lastUsedAt: null,
        revokedAt: null,
        createdAt: row.createdAt.toISOString(),
        count: 1,
      });
      continue;
    }
    existing.count += 1;
    existing.scopes = [...new Set([...existing.scopes, ...row.scopes])];
    if (row.expiresAt.toISOString() > existing.expiresAt!) {
      existing.expiresAt = row.expiresAt.toISOString();
    }
  }
  return [...groups.values()];
}

/**
 * Revokes a connected OAuth agent given the refresh-token id that represents its
 * flock row. Soft-revokes (`revoked = now()`) every live refresh token in the
 * same (client name, user) group — the refresh grant rejects revoked tokens, so
 * the agent can't refresh back in once its short-lived JWT expires.
 */
async function revokeOauthAgent(db: Db | Tx, refreshTokenId: string): Promise<void> {
  const rows = await db
    .select({
      clientId: schema.oauthRefreshToken.clientId,
      userId: schema.oauthRefreshToken.userId,
    })
    .from(schema.oauthRefreshToken)
    .where(eq(schema.oauthRefreshToken.id, refreshTokenId))
    .limit(1);
  const row = rows[0];
  if (!row?.userId) throw new NotFoundException(`token ${refreshTokenId} not found`);

  const membership = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.userId, row.userId))
    .limit(1);
  if (membership.length === 0) throw new NotFoundException(`token ${refreshTokenId} not found`);

  const nameRow = (
    await db
      .select({ name: schema.oauthClient.name })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, row.clientId))
      .limit(1)
  )[0];
  let clientIds = [row.clientId];
  if (nameRow?.name) {
    const sameName = await db
      .select({ clientId: schema.oauthClient.clientId })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.name, nameRow.name));
    clientIds = sameName.map((c) => c.clientId);
  }

  await db
    .update(schema.oauthRefreshToken)
    .set({ revoked: new Date() })
    .where(
      and(
        eq(schema.oauthRefreshToken.userId, row.userId),
        inArray(schema.oauthRefreshToken.clientId, clientIds),
        isNull(schema.oauthRefreshToken.revoked),
      ),
    );
  await db
    .delete(schema.oauthAccessToken)
    .where(
      and(
        eq(schema.oauthAccessToken.userId, row.userId),
        inArray(schema.oauthAccessToken.clientId, clientIds),
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
    count: 1,
  };
}
