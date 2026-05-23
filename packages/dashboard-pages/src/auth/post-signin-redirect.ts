export function safeRedirect(raw: string | null, fallback = '/dashboard'): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return fallback;
}

export function resumeOauthAuthorizeUrl(params: URLSearchParams): string | null {
  if (params.get('response_type') !== 'code') return null;
  if (!params.get('client_id')) return null;
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiBase)) return null;
  return `${apiBase}/auth/oauth2/authorize?${params.toString()}`;
}
