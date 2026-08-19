import { createHmac } from 'node:crypto';
import { and, eq, like, lt } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { isOrgId } from '@getmunin/core';
import { readSessionCookie } from './auth-cookies.ts';

const IDENTIFIER_PREFIX = 'mcp-org-scope:';
const TTL_MS = 600_000;

export interface OrgScopeStore {
  keyFor(cookieHeader: string | undefined, codeChallenge: string | null | undefined): string | null;
  remember(associationKey: string, orgId: string): Promise<void>;
  recall(associationKey: string): Promise<string | null>;
}

export function buildOrgScopeAssociationKey(
  secret: string,
  cookieHeader: string | undefined,
  codeChallenge: string | null | undefined,
): string | null {
  if (!secret || !codeChallenge?.trim()) return null;
  const sessionToken = readSessionCookie(cookieHeader);
  if (!sessionToken) return null;
  return createHmac('sha256', secret)
    .update(`${sessionToken}:${codeChallenge.trim()}`)
    .digest('base64url');
}

let registered: OrgScopeStore | null = null;

export function registerOrgScopeStore(store: OrgScopeStore | null): void {
  registered = store;
}

export function orgScopeStore(): OrgScopeStore | null {
  return registered;
}

export function createDbOrgScopeStore(db: Db, secret: string): OrgScopeStore {
  return {
    keyFor(cookieHeader, codeChallenge) {
      return buildOrgScopeAssociationKey(secret, cookieHeader, codeChallenge);
    },

    async remember(associationKey: string, orgId: string): Promise<void> {
      const identifier = identifierFor(associationKey);
      if (!identifier || !isOrgId(orgId)) return;
      await db
        .delete(schema.verifications)
        .where(
          and(
            like(schema.verifications.identifier, `${IDENTIFIER_PREFIX}%`),
            lt(schema.verifications.expiresAt, new Date()),
          ),
        );
      await db.delete(schema.verifications).where(eq(schema.verifications.identifier, identifier));
      await db.insert(schema.verifications).values({
        identifier,
        value: orgId,
        expiresAt: new Date(Date.now() + TTL_MS),
      });
    },

    async recall(associationKey: string): Promise<string | null> {
      const identifier = identifierFor(associationKey);
      if (!identifier) return null;
      const rows = await db
        .select({ value: schema.verifications.value, expiresAt: schema.verifications.expiresAt })
        .from(schema.verifications)
        .where(eq(schema.verifications.identifier, identifier))
        .limit(1);
      const row = rows[0];
      if (!row || row.expiresAt < new Date()) return null;
      return isOrgId(row.value) ? row.value : null;
    },
  };
}

function identifierFor(associationKey: string): string | null {
  const trimmed = associationKey.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return `${IDENTIFIER_PREFIX}${trimmed}`;
}
