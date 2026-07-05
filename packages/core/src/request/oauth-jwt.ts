import type { Db } from '@getmunin/db';
import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from 'jose';
import { ActorIdentity } from './context.ts';
import {
  gateOauthGrantsByRole,
  oauthMcpResourceAudience,
  readMembershipsForUser,
  resolvePinnedMembership,
  type ResolvedCredential,
} from './credentials.ts';

type VerifyKey = Awaited<ReturnType<typeof importJWK>>;

interface VerificationKey {
  key: VerifyKey;
  alg: string;
}

interface JwksRow {
  id: string;
  publicKey: string;
}

const jwksCache = new Map<string, VerificationKey>();

// Asymmetric algorithms only. Symmetric HMAC (HS*) is deliberately excluded so a
// stored/injected `oct` key can never enable an alg-confusion bypass where an
// HS256 token is verified against public-key bytes. BetterAuth mints EdDSA.
const ALLOWED_JWT_ALGS = new Set([
  'EdDSA',
  'ES256',
  'ES384',
  'ES512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
]);

export function looksLikeJwt(raw: string): boolean {
  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  return parts.every((p) => (p?.length ?? 0) > 0);
}

export async function resolveOauthJwtAccessToken(
  db: Db,
  rawToken: string,
): Promise<ResolvedCredential | null> {
  let header: { kid?: string; alg?: string };
  try {
    header = decodeProtectedHeader(rawToken);
  } catch (err) {
    console.warn('[credentials] JWT header decode failed', { err });
    return null;
  }
  if (!header.kid) return null;

  const verifyKey = await loadVerificationKey(db, header.kid);
  if (!verifyKey) return null;

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(rawToken, verifyKey.key, {
      issuer: jwtIssuer(),
      algorithms: [verifyKey.alg],
    });
    payload = verified.payload;
  } catch (err) {
    console.warn('[credentials] JWT verification failed', { err });
    return null;
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  if (!userId) return null;

  const audClaim = payload.aud;
  const audiencesFromJwt = Array.isArray(audClaim)
    ? audClaim
    : typeof audClaim === 'string'
      ? [audClaim]
      : [];
  if (!audiencesFromJwt.some((a) => isAcceptedJwtAudience(a))) return null;

  const scopes =
    typeof payload['scope'] === 'string' ? payload['scope'].split(/\s+/).filter(Boolean) : [];

  const memberships = await readMembershipsForUser(db, userId);
  const active = resolvePinnedMembership(
    memberships,
    typeof payload['org_id'] === 'string' ? payload['org_id'] : null,
  );
  if (!active) return null;

  const { scopes: grantedScopes, audiences } = gateOauthGrantsByRole(scopes, active.role);

  const actor = new ActorIdentity(
    'user',
    userId,
    active.orgId,
    grantedScopes,
    audiences,
    undefined,
    undefined,
    undefined,
    userId,
  );

  const expiresAt =
    typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : undefined;
  return {
    actor,
    expiresAt,
    audience: oauthMcpResourceAudience(),
  };
}

async function loadVerificationKey(db: Db, kid: string): Promise<VerificationKey | null> {
  const cached = jwksCache.get(kid);
  if (cached) return cached;
  const rows = (await db
    .select({ id: schema.jwks.id, publicKey: schema.jwks.publicKey })
    .from(schema.jwks)
    .where(eq(schema.jwks.id, kid))
    .limit(1)) as JwksRow[];
  const row = rows[0];
  if (!row) return null;
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(row.publicKey) as Record<string, unknown>;
  } catch (err) {
    console.warn('[credentials] jwks row has invalid JSON public_key', { kid, err });
    return null;
  }
  const alg = (jwk['alg'] as string | undefined) ?? 'EdDSA';
  if (!ALLOWED_JWT_ALGS.has(alg)) {
    console.warn('[credentials] jwks row has unsupported alg', { kid, alg });
    return null;
  }
  const key = await importJWK(jwk, alg);
  const entry: VerificationKey = { key, alg };
  jwksCache.set(kid, entry);
  return entry;
}

function publicUrl(): string {
  return (process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp').replace(/\/+$/, '');
}

export function jwtIssuer(): string {
  const explicit = process.env.NEXT_PUBLIC_AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  try {
    return new URL(publicUrl()).origin;
  } catch {
    return publicUrl();
  }
}

export function acceptedJwtAudiences(): Set<string> {
  const canonical = publicUrl();
  const set = new Set<string>([canonical, `${canonical}/`]);
  try {
    const origin = new URL(canonical).origin;
    set.add(origin);
    set.add(`${origin}/`);
  } catch (err) {
    console.warn('[credentials] publicUrl is not a parseable URL', { err });
  }
  return set;
}

function isAcceptedJwtAudience(aud: string): boolean {
  return acceptedJwtAudiences().has(aud);
}
