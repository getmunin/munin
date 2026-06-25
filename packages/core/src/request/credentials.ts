import { createHash } from 'node:crypto';
import type { Db } from '@getmunin/db';
import { schema } from '@getmunin/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { ActorIdentity, type ActorType, type Audience } from './context.ts';
import { hashSecret } from '../crypto/primitives.ts';
import { looksLikeJwt, resolveOauthJwtAccessToken } from './oauth-jwt.ts';

async function readMembershipsForUser(
  db: Db,
  userId: string,
): Promise<Array<typeof schema.orgMembers.$inferSelect>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return tx
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.userId, userId));
  });
}

export { readMembershipsForUser };

function resolvePinnedMembership(
  memberships: Array<typeof schema.orgMembers.$inferSelect>,
  pinnedOrgId: string | null,
): (typeof schema.orgMembers.$inferSelect) | undefined {
  if (pinnedOrgId) return memberships.find((m) => m.orgId === pinnedOrgId);
  return memberships.find((m) => m.isDefault) ?? memberships[0];
}

export { resolvePinnedMembership };

function hashOauthOpaqueToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('base64url');
}

const WIDGET_ALLOWED_SCOPES: ReadonlySet<string> = new Set(['conv:widget:write']);

export interface ResolvedCredential {
  actor: ActorIdentity;
  expiresAt?: Date;
  audience?: string;
}

export class CredentialResolver {
  constructor(private readonly db: Db) {}

  async resolveBearerToken(rawToken: string): Promise<ResolvedCredential | null> {
    if (looksLikeJwt(rawToken)) {
      const jwtHit = await resolveOauthJwtAccessToken(this.db, rawToken);
      if (jwtHit) return jwtHit;
    }
    const oauthHit = await this.resolveOauthAccessToken(rawToken);
    if (oauthHit) return oauthHit;

    const tokenHash = hashSecret(rawToken);
    const rows = await this.db
      .select()
      .from(schema.tokens)
      .where(and(eq(schema.tokens.tokenHash, tokenHash), isNull(schema.tokens.revokedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;

    const audiences = row.audiences as Audience[];
    const type =
      row.type === 'delegated_end_user' || row.type === 'guest' ? 'end_user_agent' : 'admin_agent';

    const actor = new ActorIdentity(
      type,
      row.agentId ?? row.id,
      row.orgId,
      row.scopes,
      audiences,
      row.endUserId ?? undefined,
      row.id,
      undefined,
      row.userId ?? undefined,
    );

    void this.db
      .update(schema.tokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.tokens.id, row.id))
      .catch(() => {});

    return { actor, expiresAt: row.expiresAt ?? undefined };
  }

  private async resolveOauthAccessToken(
    rawToken: string,
  ): Promise<ResolvedCredential | null> {
    const tokenRows = await this.db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.token, hashOauthOpaqueToken(rawToken)))
      .limit(1);
    const tokenRow = tokenRows[0];
    if (!tokenRow) return null;
    if (tokenRow.expiresAt < new Date()) return null;
    if (!tokenRow.userId) return null;

    const memberships = await readMembershipsForUser(this.db, tokenRow.userId);
    const active = resolvePinnedMembership(memberships, tokenRow.referenceId);
    if (!active) return null;

    const scopes = tokenRow.scopes;
    const audiences = deriveAudiencesFromScopes(scopes);

    const actor = new ActorIdentity(
      'user',
      tokenRow.userId,
      active.orgId,
      scopes,
      audiences,
      undefined,
      tokenRow.id,
      undefined,
      tokenRow.userId,
    );

    return {
      actor,
      expiresAt: tokenRow.expiresAt,
      audience: oauthMcpResourceAudience(),
    };
  }

  async resolveApiKey(rawKey: string): Promise<ResolvedCredential | null> {
    const keyPrefix = rawKey.slice(0, 8);
    const keyHash = hashSecret(rawKey);

    const apiKeys = await this.db
      .select()
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.keyPrefix, keyPrefix),
          eq(schema.apiKeys.keyHash, keyHash),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .limit(1);

    const row = apiKeys[0];
    if (!row) return null;

    const orgId = row.orgId ?? '';
    let actorType: ActorType;
    let audiences: readonly Audience[];
    let scopes: readonly string[];
    if (row.type === 'admin') {
      actorType = 'admin_agent';
      audiences = (row.audiences as Audience[] | null | undefined) ?? ['admin'];
      scopes = row.scopes;
    } else if (row.type === 'widget') {
      actorType = 'widget_agent';
      audiences = ['self_service'];
      scopes = row.scopes.filter((s) => WIDGET_ALLOWED_SCOPES.has(s));
    } else {
      return null;
    }
    const actor = new ActorIdentity(
      actorType,
      row.id,
      orgId,
      scopes,
      audiences,
      undefined,
      undefined,
      undefined,
      row.createdByUserId ?? undefined,
    );

    void this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, row.id))
      .catch(() => {});

    return { actor };
  }

  async resolveSessionToken(rawToken: string): Promise<ResolvedCredential | null> {
    const sessionRows = await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.token, rawToken), gt(schema.sessions.expiresAt, new Date())))
      .limit(1);
    const session = sessionRows[0];
    if (!session) return null;

    const memberships = await readMembershipsForUser(this.db, session.userId);
    const membership =
      memberships.find((m) => m.isDefault) ??
      [...memberships].sort((a, b) => +a.createdAt - +b.createdAt)[0];
    if (!membership) return null;

    const actor = new ActorIdentity(
      'user',
      session.userId,
      membership.orgId,
      ['*'],
      ['admin'],
      undefined,
      session.id,
      undefined,
      session.userId,
    );
    return { actor, expiresAt: session.expiresAt };
  }

  async resolveSessionUserId(rawToken: string): Promise<string | null> {
    const rows = await this.db
      .select({ userId: schema.sessions.userId })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.token, rawToken), gt(schema.sessions.expiresAt, new Date())))
      .limit(1);
    return rows[0]?.userId ?? null;
  }
}

export function oauthMcpResourceAudience(): string {
  return (process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp').replace(/\/+$/, '');
}

export function deriveAudiencesFromScopes(scopes: string[]): Audience[] {
  const set = new Set<Audience>();
  for (const scope of scopes) {
    if (scope === 'mcp:admin') set.add('admin');
    if (scope === 'mcp:self_service') set.add('self_service');
  }
  return Array.from(set);
}
