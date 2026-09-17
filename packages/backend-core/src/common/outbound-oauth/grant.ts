export interface StoredOAuthGrant {
  encryptedRefreshToken: string;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: string | null;
  scopes: string[];
  connectedAt: string;
}

export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

export function readGrant(value: unknown): StoredOAuthGrant | null {
  if (!value || typeof value !== 'object') return null;
  const grant = value as Partial<StoredOAuthGrant>;
  if (typeof grant.encryptedRefreshToken !== 'string') return null;
  return {
    encryptedRefreshToken: grant.encryptedRefreshToken,
    encryptedAccessToken:
      typeof grant.encryptedAccessToken === 'string' ? grant.encryptedAccessToken : null,
    accessTokenExpiresAt:
      typeof grant.accessTokenExpiresAt === 'string' ? grant.accessTokenExpiresAt : null,
    scopes: Array.isArray(grant.scopes) ? grant.scopes.filter((s) => typeof s === 'string') : [],
    connectedAt: typeof grant.connectedAt === 'string' ? grant.connectedAt : '',
  };
}

export function accessTokenIsFresh(
  grant: StoredOAuthGrant,
  skewMs: number = ACCESS_TOKEN_REFRESH_SKEW_MS,
  now: number = Date.now(),
): boolean {
  if (!grant.encryptedAccessToken) return false;
  if (!grant.accessTokenExpiresAt) return false;
  const ms = Date.parse(grant.accessTokenExpiresAt);
  if (!Number.isFinite(ms)) return false;
  return ms - skewMs > now;
}

export class MissingRefreshTokenError extends Error {
  constructor() {
    super('refresh token missing from the vendor response');
  }
}

export function nextGrant(input: {
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  expiresInSeconds?: number | undefined;
  scopes: readonly string[];
  previous: StoredOAuthGrant | null;
  now?: number;
}): StoredOAuthGrant {
  const encryptedRefreshToken =
    input.encryptedRefreshToken ?? input.previous?.encryptedRefreshToken ?? null;
  if (!encryptedRefreshToken) throw new MissingRefreshTokenError();
  const now = input.now ?? Date.now();
  return {
    encryptedRefreshToken,
    encryptedAccessToken: input.encryptedAccessToken,
    accessTokenExpiresAt: input.expiresInSeconds
      ? new Date(now + input.expiresInSeconds * 1000).toISOString()
      : null,
    scopes: [...input.scopes],
    connectedAt: input.previous?.connectedAt || new Date(now).toISOString(),
  };
}
