const DEFAULT_COOKIE_PREFIX = 'better-auth';

export function authCookiePrefix(): string {
  return process.env.MUNIN_AUTH_COOKIE_PREFIX?.trim() || DEFAULT_COOKIE_PREFIX;
}

export function sessionCookieNames(): string[] {
  const prefix = authCookiePrefix();
  return [`${prefix}.session_token`, `__Secure-${prefix}.session_token`];
}
