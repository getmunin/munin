import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair, importPKCS8 } from 'jose';
import { schema, makeId, type Db, type Tx } from '@getmunin/db';
import {
  decryptSecretSql,
  encryptSecretSql,
  readApiBaseUrl,
  setEncryptionKeySql,
} from '@getmunin/core';
import { CUSTOM_MCP_VENDOR } from './custom-mcp.adapter.ts';
import { identityProvenance, type IdentityProvenance } from './identity-provenance.ts';

export const IDENTITY_ASSERTION_HEADER = 'x-munin-identity';
export const DEFAULT_ASSERTION_TTL_SECONDS = 300;
const MAX_SLUG_LENGTH = 24;

export interface ExternalMcpEndpoint {
  connectionId: string;
  name: string;
  slug: string;
  url: string;
  bearerToken: string;
  identityAssertion: string;
}

export interface IdentityAssertionClaims {
  orgId: string;
  endUserId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  provenance: IdentityProvenance;
}

export function slugifyConnectionName(name: string): string {
  const collapsed = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const slug = trimUnderscores(trimUnderscores(collapsed).slice(0, MAX_SLUG_LENGTH));
  return slug || 'connection';
}

function trimUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '_') start += 1;
  while (end > start && value[end - 1] === '_') end -= 1;
  return value.slice(start, end);
}

export async function readOrgConnectorJwks(
  db: Db,
  orgId: string,
): Promise<{ keys: Record<string, unknown>[] }> {
  const rows = await db.transaction(async (tx) => {
    await bypassRls(tx);
    return tx
      .select({ publicJwk: schema.connectorSigningKeys.publicJwk })
      .from(schema.connectorSigningKeys)
      .where(eq(schema.connectorSigningKeys.orgId, orgId));
  });
  return { keys: rows.map((r) => r.publicJwk) };
}

export async function listExternalMcpEndpoints(
  db: Db,
  args: { orgId: string; endUserId: string; channelType?: string | null; ttlSeconds?: number },
): Promise<ExternalMcpEndpoint[]> {
  const connections = await db.transaction(async (tx) => {
    await bypassRls(tx);
    return tx
      .select()
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.orgId, args.orgId),
          eq(schema.connectorConnections.domain, 'mcp'),
          eq(schema.connectorConnections.vendor, CUSTOM_MCP_VENDOR),
          eq(schema.connectorConnections.active, true),
          eq(schema.connectorConnections.credentialState, 'active'),
        ),
      )
      .orderBy(schema.connectorConnections.createdAt);
  });
  if (connections.length === 0) return [];

  const claims = await readIdentityClaims(db, args.orgId, args.endUserId, args.channelType);
  if (!claims) return [];
  const key = await getOrCreateSigningKey(db, args.orgId);
  const privateKey = await importPKCS8(key.privateKeyPem, 'ES256');
  const ttlSeconds = args.ttlSeconds ?? DEFAULT_ASSERTION_TTL_SECONDS;

  const endpoints: ExternalMcpEndpoint[] = [];
  const usedSlugs = new Set<string>();
  for (const connection of connections) {
    const url = typeof connection.config.url === 'string' ? connection.config.url : null;
    const encrypted =
      typeof connection.config.encryptedBearerToken === 'string'
        ? connection.config.encryptedBearerToken
        : null;
    if (!url || !encrypted) continue;
    const bearerToken = await decryptDetached(db, encrypted);
    if (bearerToken === null) continue;
    const identityAssertion = await signIdentityAssertion({
      claims,
      audience: url,
      kid: key.kid,
      privateKey,
      ttlSeconds,
    });
    let slug = slugifyConnectionName(connection.name);
    for (let i = 2; usedSlugs.has(slug); i += 1) {
      slug = `${slugifyConnectionName(connection.name)}_${i}`;
    }
    usedSlugs.add(slug);
    endpoints.push({
      connectionId: connection.id,
      name: connection.name,
      slug,
      url,
      bearerToken,
      identityAssertion,
    });
  }
  return endpoints;
}

export async function signIdentityAssertion(args: {
  claims: IdentityAssertionClaims;
  audience: string;
  kid: string;
  privateKey: Parameters<SignJWT['sign']>[0];
  ttlSeconds: number;
}): Promise<string> {
  const { claims } = args;
  const payload: Record<string, unknown> = { org_id: claims.orgId };
  if (claims.email) {
    payload.email = claims.email;
    payload.email_provenance = claims.provenance;
  }
  if (claims.phone) {
    payload.phone = claims.phone;
    payload.phone_provenance = claims.provenance;
  }
  if (claims.name) payload.name = claims.name;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: args.kid })
    .setIssuer(readApiBaseUrl())
    .setSubject(claims.endUserId)
    .setAudience(args.audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + args.ttlSeconds)
    .setJti(randomUUID())
    .sign(args.privateKey);
}

export async function readIdentityClaims(
  db: Db,
  orgId: string,
  endUserId: string,
  channelType?: string | null,
): Promise<IdentityAssertionClaims | null> {
  const rows = await db.transaction(async (tx) => {
    await bypassRls(tx);
    return tx
      .select({
        email: schema.endUsers.email,
        phone: schema.endUsers.phone,
        name: schema.endUsers.name,
        metadata: schema.endUsers.metadata,
      })
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.id, endUserId)))
      .limit(1);
  });
  const row = rows[0];
  if (!row) return null;
  return {
    orgId,
    endUserId,
    email: row.email,
    phone: row.phone,
    name: row.name,
    provenance: identityProvenance({ channelType, metadata: row.metadata }),
  };
}

export async function getOrCreateSigningKey(
  db: Db,
  orgId: string,
): Promise<{ kid: string; privateKeyPem: string; publicJwk: Record<string, unknown> }> {
  const existing = await loadSigningKey(db, orgId);
  if (existing) return existing;

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const kid = makeId('csk');
  const publicJwk: Record<string, unknown> = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  const privateKeyPem = await exportPKCS8(privateKey);

  await db.transaction(async (tx) => {
    await bypassRls(tx);
    await tx.execute(setEncryptionKeySql());
    const encrypted = await tx.execute<{ ct: string } & Record<string, unknown>>(
      sql`SELECT ${encryptSecretSql(privateKeyPem)} AS ct`,
    );
    const ct = encrypted[0]?.ct;
    if (!ct) throw new Error('connector signing key encryption failed');
    await tx
      .insert(schema.connectorSigningKeys)
      .values({ id: kid, orgId, publicJwk, privateKeyPem: ct })
      .onConflictDoNothing();
  });

  const stored = await loadSigningKey(db, orgId);
  if (!stored) throw new Error('connector signing key creation failed');
  return stored;
}

async function loadSigningKey(
  db: Db,
  orgId: string,
): Promise<{ kid: string; privateKeyPem: string; publicJwk: Record<string, unknown> } | null> {
  return db.transaction(async (tx) => {
    await bypassRls(tx);
    const rows = await tx
      .select()
      .from(schema.connectorSigningKeys)
      .where(eq(schema.connectorSigningKeys.orgId, orgId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    await tx.execute(setEncryptionKeySql());
    const decrypted = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(row.privateKeyPem)} AS pt`,
    );
    const pt = decrypted[0]?.pt;
    if (pt === undefined || pt === null) return null;
    return { kid: row.id, privateKeyPem: pt, publicJwk: row.publicJwk };
  });
}

async function decryptDetached(db: Db, ciphertext: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    return rows[0]?.pt ?? null;
  });
}

async function bypassRls(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
}
