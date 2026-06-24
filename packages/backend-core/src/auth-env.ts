/**
 * Env-reading helpers shared between OSS and cloud auth bootstraps.
 * Edition-specific helpers (e.g. allowed-domain allowlist for OSS) stay
 * in the edition's own auth.config.
 */

export function readGoogleProviderFromEnv(): { clientId: string; clientSecret: string } | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

export function readGithubProviderFromEnv(): { clientId: string; clientSecret: string } | undefined {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

export interface TurnstileCaptchaEnv {
  provider: 'cloudflare-turnstile';
  secretKey: string;
  siteKey: string;
}

export function readTurnstileCaptchaFromEnv(): TurnstileCaptchaEnv | undefined {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  if (!secretKey || !siteKey) return undefined;
  return { provider: 'cloudflare-turnstile', secretKey, siteKey };
}

export function readTrustedOriginsFromEnv(): string[] {
  const env = process.env.MUNIN_AUTH_TRUSTED_ORIGINS;
  if (!env) return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}
