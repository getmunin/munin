import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  hasSessionCookie,
  isSetupGatedPath,
  setupPathFor,
  withSetupGate,
  type SetupGateOptions,
} from './setup-gate';

const LOCALES = ['en', 'nb'] as const;
const ROOT: SetupGateOptions = { locales: LOCALES };
const SUBTREE: SetupGateOptions = {
  locales: LOCALES,
  scope: 'subtree',
  exempt: ['account', 'oauth/consent'],
};

describe('isSetupGatedPath', () => {
  it('gates the dashboard root of every supported locale', () => {
    expect(isSetupGatedPath('/en/dashboard', ROOT)).toBe(true);
    expect(isSetupGatedPath('/nb/dashboard', ROOT)).toBe(true);
    expect(isSetupGatedPath('/en/dashboard/', ROOT)).toBe(true);
  });

  it('leaves subpages alone in root scope', () => {
    expect(isSetupGatedPath('/en/dashboard/settings', ROOT)).toBe(false);
    expect(isSetupGatedPath('/en/dashboard/account', ROOT)).toBe(false);
  });

  it('gates subpages in subtree scope', () => {
    expect(isSetupGatedPath('/en/dashboard/settings', SUBTREE)).toBe(true);
    expect(isSetupGatedPath('/en/dashboard/settings/channels', SUBTREE)).toBe(true);
    expect(isSetupGatedPath('/en/dashboard', SUBTREE)).toBe(true);
  });

  it('honours exempt prefixes in subtree scope', () => {
    expect(isSetupGatedPath('/en/dashboard/account', SUBTREE)).toBe(false);
    expect(isSetupGatedPath('/en/dashboard/oauth/consent', SUBTREE)).toBe(false);
    expect(isSetupGatedPath('/nb/dashboard/account/danger', SUBTREE)).toBe(false);
  });

  it('ignores paths that only look like the dashboard root', () => {
    expect(isSetupGatedPath('/dashboard', ROOT)).toBe(false);
    expect(isSetupGatedPath('/de/dashboard', ROOT)).toBe(false);
    expect(isSetupGatedPath('/en/dashboards', ROOT)).toBe(false);
    expect(isSetupGatedPath('/en/setup', ROOT)).toBe(false);
  });
});

describe('setupPathFor', () => {
  it('keeps the locale prefix of the request', () => {
    expect(setupPathFor('/en/dashboard')).toBe('/en/setup');
    expect(setupPathFor('/nb/dashboard')).toBe('/nb/setup');
    expect(setupPathFor('/en/dashboard/')).toBe('/en/setup');
    expect(setupPathFor('/nb/dashboard/settings/channels')).toBe('/nb/setup');
  });

  it('stays linear on a path stuffed with repeated dashboard segments', () => {
    expect(setupPathFor(`/en${'/dashboard'.repeat(5000)}`)).toBe('/en/setup');
  });

  it('leaves a path without the segment alone', () => {
    expect(setupPathFor('/en/setup')).toBe('/en/setup');
  });
});

describe('hasSessionCookie', () => {
  it('detects the session cookie whatever prefix it carries', () => {
    expect(hasSessionCookie('better-auth.session_token=abc')).toBe(true);
    expect(hasSessionCookie('__Secure-better-auth.session_token=abc; munin_locale=en')).toBe(true);
  });

  it('is false without one', () => {
    expect(hasSessionCookie('')).toBe(false);
    expect(hasSessionCookie('munin_locale=en')).toBe(false);
  });
});

const SESSION = 'better-auth.session_token=abc.def';

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

function stubApi(config: unknown, memberships: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL) => {
      const body = String(url).includes('/v1/agent-config') ? config : memberships;
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
}

describe('withSetupGate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('redirects an owner with an unnamed org to setup', async () => {
    stubApi({ providerConfigured: true }, [
      { orgId: 'o', name: '', role: 'owner', isDefault: true },
    ]);
    const handle = withSetupGate(() => NextResponse.next(), ROOT);
    const res = await handle(request('/en/dashboard', SESSION));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/en/setup');
  });

  it('preserves search params on the redirect', async () => {
    stubApi({ providerConfigured: false }, [
      { orgId: 'o', name: 'Acme', role: 'owner', isDefault: true },
    ]);
    const handle = withSetupGate(() => NextResponse.next(), ROOT);
    const res = await handle(request('/nb/dashboard?client_id=abc', SESSION));
    expect(res.headers.get('location')).toBe('http://localhost:3000/nb/setup?client_id=abc');
  });

  it('passes through once setup is complete', async () => {
    stubApi({ providerConfigured: true }, [
      { orgId: 'o', name: 'Acme', role: 'owner', isDefault: true },
    ]);
    const handle = withSetupGate(() => NextResponse.next(), ROOT);
    const res = await handle(request('/en/dashboard', SESSION));
    expect(res.headers.get('location')).toBeNull();
  });

  it('passes through a non-admin member', async () => {
    stubApi({ providerConfigured: false }, [
      { orgId: 'o', name: '', role: 'member', isDefault: true },
    ]);
    const handle = withSetupGate(() => NextResponse.next(), ROOT);
    const res = await handle(request('/en/dashboard', SESSION));
    expect(res.headers.get('location')).toBeNull();
  });

  it('passes through when the status reads fail', async () => {
    stubApi({}, {}, 500);
    const handle = withSetupGate(() => NextResponse.next(), ROOT);
    const res = await handle(request('/en/dashboard', SESSION));
    expect(res.headers.get('location')).toBeNull();
  });

  it('never calls the API without a session cookie', async () => {
    stubApi({ providerConfigured: false }, []);
    const handle = withSetupGate(() => NextResponse.next(), ROOT);
    const res = await handle(request('/en/dashboard'));
    expect(res.headers.get('location')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never calls the API on an ungated path', async () => {
    stubApi({ providerConfigured: false }, []);
    const handle = withSetupGate(() => NextResponse.next(), ROOT);
    await handle(request('/en/dashboard/settings', SESSION));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trims trailing slashes off the configured api url', async () => {
    stubApi({ providerConfigured: true }, [
      { orgId: 'o', name: 'Acme', role: 'owner', isDefault: true },
    ]);
    const handle = withSetupGate(() => NextResponse.next(), {
      ...ROOT,
      apiUrl: 'http://api.test///',
    });
    await handle(request('/en/dashboard', SESSION));
    expect(fetch).toHaveBeenCalledWith('http://api.test/v1/agent-config', expect.anything());
  });

  it('leaves an upstream locale redirect untouched', async () => {
    stubApi({ providerConfigured: false }, [
      { orgId: 'o', name: '', role: 'owner', isDefault: true },
    ]);
    const upstream = NextResponse.redirect('http://localhost:3000/en/dashboard');
    const handle = withSetupGate(() => upstream, ROOT);
    const res = await handle(request('/dashboard', SESSION));
    expect(res.headers.get('location')).toBe('http://localhost:3000/en/dashboard');
    expect(fetch).not.toHaveBeenCalled();
  });
});
