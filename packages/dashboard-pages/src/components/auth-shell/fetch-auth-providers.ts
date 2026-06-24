export interface CaptchaConfig {
  provider: 'cloudflare-turnstile';
  siteKey: string;
}

export interface AuthProviders {
  google: boolean;
  github: boolean;
  captcha?: CaptchaConfig;
}

const SERVER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function fetchAuthProviders(): Promise<AuthProviders> {
  try {
    const res = await fetch(`${SERVER_API_URL}/v1/auth/providers`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return (await res.json()) as AuthProviders;
  } catch (err) {
    console.warn('[auth-providers] server fetch failed', err);
    return { google: false, github: false };
  }
}
