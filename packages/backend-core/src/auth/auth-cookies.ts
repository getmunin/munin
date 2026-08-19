const DEFAULT_COOKIE_PREFIX = 'better-auth';

export function authCookiePrefix(): string {
  return process.env.MUNIN_AUTH_COOKIE_PREFIX?.trim() || DEFAULT_COOKIE_PREFIX;
}

export function sessionCookieNames(): string[] {
  const prefix = authCookiePrefix();
  return [`${prefix}.session_token`, `__Secure-${prefix}.session_token`];
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const names = sessionCookieNames();
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!names.includes(name)) continue;
    const raw = decodeURIComponent(part.slice(eq + 1).trim());
    const dot = raw.indexOf('.');
    return dot >= 0 ? raw.slice(0, dot) : raw;
  }
  return null;
}
