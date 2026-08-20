export const AUTHORIZATION_CLOCK_GRACE_MS = 60_000;

export function authorizationExpiresAt(raw: string | null | undefined): number | null {
  const seconds = Number(raw ?? '');
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000 + AUTHORIZATION_CLOCK_GRACE_MS;
}

export function authorizationHasExpired(
  raw: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const expiresAt = authorizationExpiresAt(raw);
  return expiresAt !== null && expiresAt <= now;
}
