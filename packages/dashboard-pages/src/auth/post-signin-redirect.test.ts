import { describe, it, expect, beforeEach } from 'vitest';
import {
  oauthResumeFromSearchParams,
  resumeOauthAuthorizeUrl,
  safeRedirect,
  signInHrefFor,
} from './post-signin-redirect';

const AUTHORIZE_SP = {
  response_type: 'code',
  client_id: 'client-123',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  scope: 'kb:read crm:write',
  state: 'xyz',
};

describe('oauthResumeFromSearchParams', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
  });

  it('builds the authorize resume URL from page search params', () => {
    const url = oauthResumeFromSearchParams(AUTHORIZE_SP);
    expect(url).toBe(
      `https://api.example.com/auth/oauth2/authorize?${new URLSearchParams(AUTHORIZE_SP).toString()}`,
    );
  });

  it('returns null without response_type=code', () => {
    expect(oauthResumeFromSearchParams({ client_id: 'client-123' })).toBeNull();
    expect(oauthResumeFromSearchParams({ redirect: '/dashboard' })).toBeNull();
    expect(oauthResumeFromSearchParams({})).toBeNull();
  });

  it('returns null without client_id', () => {
    expect(oauthResumeFromSearchParams({ response_type: 'code' })).toBeNull();
  });

  it('uses the first value of repeated params', () => {
    const url = oauthResumeFromSearchParams({
      ...AUTHORIZE_SP,
      client_id: ['client-123', 'client-456'],
    });
    expect(url).toContain('client_id=client-123');
  });
});

describe('resumeOauthAuthorizeUrl', () => {
  it('preserves the full oauth query verbatim', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/';
    const params = new URLSearchParams(AUTHORIZE_SP);
    const url = resumeOauthAuthorizeUrl(params);
    expect(url).toBe(`https://api.example.com/auth/oauth2/authorize?${params.toString()}`);
  });
});

describe('safeRedirect', () => {
  it('accepts app-relative paths', () => {
    expect(safeRedirect('/dashboard/settings')).toBe('/dashboard/settings');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeRedirect('https://evil.example.com')).toBe('/dashboard');
    expect(safeRedirect('//evil.example.com')).toBe('/dashboard');
    expect(safeRedirect(null)).toBe('/dashboard');
  });
});

describe('signInHrefFor', () => {
  it('carries an org-scoped destination through the sign-in round trip', () => {
    const dest = '/o/org_0123456789abcdefghijkl/dashboard/review/spd_1';
    expect(signInHrefFor(dest)).toBe(`/login?redirect=${encodeURIComponent(dest)}`);
    expect(safeRedirect(decodeURIComponent(signInHrefFor(dest).split('redirect=')[1]!))).toBe(dest);
  });

  it('keeps the query string so a filtered view survives sign-in', () => {
    const dest = '/o/org_0123456789abcdefghijkl/dashboard/conversations?status=open';
    expect(signInHrefFor(dest)).toContain(encodeURIComponent('?status=open'));
  });

  it('sends a bare dashboard destination to plain /login', () => {
    expect(signInHrefFor('/dashboard')).toBe('/login');
    expect(signInHrefFor(null)).toBe('/login');
  });
});
