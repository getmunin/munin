import type { Db } from '@munin/db';
import { schema } from '@munin/db';
import { and, eq, isNull } from 'drizzle-orm';
import { ActorIdentity, type Audience } from './context.js';
import { hashSecret } from './crypto.js';

export interface ResolvedCredential {
  actor: ActorIdentity;
  /** When the credential expires; undefined for non-expiring API keys. */
  expiresAt?: Date;
}

/**
 * Resolves an incoming bearer token or API key into an `ActorIdentity`,
 * including org membership and audience scopes.
 *
 * This runs OUTSIDE the request transaction (auth must succeed before we
 * open a tenant-bound connection). So it takes the Db as a constructor
 * argument rather than reading from RequestContext.
 */
export class CredentialResolver {
  constructor(private readonly db: Db) {}

  /**
   * Resolve an OAuth access token or delegated end-user JWT.
   *
   * For v0.4 we store these in the `tokens` table keyed by token-hash;
   * a JWT-only flow can come later.
   */
  async resolveBearerToken(rawToken: string): Promise<ResolvedCredential | null> {
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

    // Touch last-used asynchronously; don't block the request on it.
    void this.db
      .update(schema.tokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.tokens.id, row.id))
      .catch(() => {});

    return { actor, expiresAt: row.expiresAt ?? undefined };
  }

  /**
   * Resolve an admin API key or partner key.
   *
   * Format expected: `<prefix>_<random-base64url>`. The prefix narrows the
   * lookup so we don't hash every key on every request.
   */
  async resolveApiKey(rawKey: string): Promise<ResolvedCredential | null> {
    const keyPrefix = rawKey.slice(0, 8);
    const keyHash = hashSecret(rawKey);

    // Try keys table (admin / partner)
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
    if (row) {
      const isPartner = row.type === 'partner';

      // Partner keys carry a partnerId, no orgId by themselves.
      // For admin keys, orgId is set.
      const orgId = row.orgId ?? '';
      const actor = new ActorIdentity(
        isPartner ? 'partner' : 'admin_agent',
        row.id,
        orgId,
        row.scopes,
        ['admin'],
        undefined,
        undefined,
        row.partnerId ?? undefined,
        row.createdByUserId ?? undefined,
      );

      void this.db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, row.id))
        .catch(() => {});

      return { actor };
    }

    // Try partners table directly (raw partner key, separate from apiKeys table for clarity)
    const partners = await this.db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.partnerKeyHash, keyHash))
      .limit(1);
    const partner = partners[0];
    if (partner) {
      const actor = new ActorIdentity(
        'partner',
        partner.id,
        '',
        partner.scopes,
        ['admin'],
        undefined,
        undefined,
        partner.id,
      );
      return { actor };
    }

    return null;
  }
}
