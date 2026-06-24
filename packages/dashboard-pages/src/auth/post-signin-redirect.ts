export function safeRedirect(raw: string | null, fallback = '/dashboard'): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return fallback;
}

export function absoluteCallbackUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, window.location.origin).toString();
}

export function resumeOauthAuthorizeUrl(params: URLSearchParams): string | null {
  if (params.get('response_type') !== 'code') return null;
  if (!params.get('client_id')) return null;
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiBase)) return null;
  return `${apiBase}/auth/oauth2/authorize?${params.toString()}`;
}

export function hasOauthAuthorizeParams(params: URLSearchParams): boolean {
  return params.get('response_type') === 'code' && !!params.get('client_id');
}

export function oauthParamString(params: URLSearchParams): string {
  if (!hasOauthAuthorizeParams(params)) return '';
  return params.toString();
}

export function socialCallbackUrl(params: URLSearchParams, redirectTo: string): string {
  return resumeOauthAuthorizeUrl(params) ?? absoluteCallbackUrl(redirectTo);
}
