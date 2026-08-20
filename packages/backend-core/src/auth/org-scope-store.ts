import { createHmac } from 'node:crypto';
import { and, eq, like, lt } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { MCP_BASE_PATH, isOrgId, type OrgScopedResourcePath } from '@getmunin/core';
import { readSessionCookie } from './auth-cookies.ts';

const IDENTIFIER_PREFIX = 'mcp-org-scope:';
const TTL_MS = 3_600_000;

export interface OrgScopeAssociationKeys {
  session: string | null;
  challenge: string | null;
}

export interface OrgScopeStore {
  keysFor(
    cookieHeader: string | undefined,
    codeChallenge: string | null | undefined,
  ): OrgScopeAssociationKeys;
  remember(keys: OrgScopeAssociationKeys, orgId: string, basePath?: string): Promise<void>;
  recall(keys: OrgScopeAssociationKeys): Promise<OrgScopedResourcePath | null>;
}

export function encodeOrgScopeAssociation(orgId: string, basePath: string): string {
  return basePath === MCP_BASE_PATH ? orgId : `${orgId} ${basePath}`;
}

export function decodeOrgScopeAssociation(value: string): OrgScopedResourcePath | null {
  const [orgId, basePath] = value.trim().split(/\s+/, 2);
  if (!orgId || !isOrgId(orgId)) return null;
  if (!basePath) return { orgId, basePath: MCP_BASE_PATH };
  return basePath.startsWith(`${MCP_BASE_PATH}/`) ? { orgId, basePath } : null;
}

export function buildOrgScopeAssociationKeys(
  secret: string,
  cookieHeader: string | undefined,
  codeChallenge: string | null | undefined,
): OrgScopeAssociationKeys {
  const challenge = codeChallenge?.trim();
  if (!secret || !challenge) return { session: null, challenge: null };
  const sessionToken = readSessionCookie(cookieHeader);
  return {
    session: sessionToken ? digest(secret, `session:${sessionToken}:${challenge}`) : null,
    challenge: digest(secret, `challenge:${challenge}`),
  };
}

export function hasOrgScopeAssociationKey(keys: OrgScopeAssociationKeys | null): boolean {
  return Boolean(keys && (keys.session || keys.challenge));
}

let registered: OrgScopeStore | null = null;

export function registerOrgScopeStore(store: OrgScopeStore | null): void {
  registered = store;
}

export function orgScopeStore(): OrgScopeStore | null {
  return registered;
}

export function createDbOrgScopeStore(db: Db, secret: string): OrgScopeStore {
  async function readOne(associationKey: string): Promise<OrgScopedResourcePath | null> {
    const identifier = identifierFor(associationKey);
    if (!identifier) return null;
    const rows = await db
      .select({ value: schema.verifications.value, expiresAt: schema.verifications.expiresAt })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, identifier))
      .limit(1);
    const row = rows[0];
    if (!row || row.expiresAt < new Date()) return null;
    return decodeOrgScopeAssociation(row.value);
  }

  async function extend(associationKey: string): Promise<void> {
    const identifier = identifierFor(associationKey);
    if (!identifier) return;
    await db
      .update(schema.verifications)
      .set({ expiresAt: new Date(Date.now() + TTL_MS) })
      .where(eq(schema.verifications.identifier, identifier));
  }

  return {
    keysFor(cookieHeader, codeChallenge) {
      return buildOrgScopeAssociationKeys(secret, cookieHeader, codeChallenge);
    },

    async remember(
      keys: OrgScopeAssociationKeys,
      orgId: string,
      basePath: string = MCP_BASE_PATH,
    ): Promise<void> {
      if (!isOrgId(orgId) || !hasOrgScopeAssociationKey(keys)) return;
      const value = encodeOrgScopeAssociation(orgId, basePath);
      if (!decodeOrgScopeAssociation(value)) return;
      await db
        .delete(schema.verifications)
        .where(
          and(
            like(schema.verifications.identifier, `${IDENTIFIER_PREFIX}%`),
            lt(schema.verifications.expiresAt, new Date()),
          ),
        );

      const sessionIdentifier = keys.session ? identifierFor(keys.session) : null;
      if (sessionIdentifier) {
        await db
          .delete(schema.verifications)
          .where(eq(schema.verifications.identifier, sessionIdentifier));
        await db.insert(schema.verifications).values({
          identifier: sessionIdentifier,
          value,
          expiresAt: new Date(Date.now() + TTL_MS),
        });
      }

      const challengeIdentifier = keys.challenge ? identifierFor(keys.challenge) : null;
      if (challengeIdentifier && !(await readOne(keys.challenge!))) {
        await db
          .delete(schema.verifications)
          .where(eq(schema.verifications.identifier, challengeIdentifier));
        await db.insert(schema.verifications).values({
          identifier: challengeIdentifier,
          value,
          expiresAt: new Date(Date.now() + TTL_MS),
        });
      }
    },

    async recall(keys: OrgScopeAssociationKeys): Promise<OrgScopedResourcePath | null> {
      if (keys.session) {
        const fromSession = await readOne(keys.session);
        if (fromSession) {
          await extend(keys.session);
          return fromSession;
        }
      }
      if (!keys.challenge) return null;
      const fromChallenge = await readOne(keys.challenge);
      if (fromChallenge) await extend(keys.challenge);
      return fromChallenge;
    },
  };
}

function digest(secret: string, material: string): string {
  return createHmac('sha256', secret).update(material).digest('base64url');
}

function identifierFor(associationKey: string): string | null {
  const trimmed = associationKey.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return `${IDENTIFIER_PREFIX}${trimmed}`;
}
