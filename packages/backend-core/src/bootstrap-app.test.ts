import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  hostAllowlistMiddleware,
  isPublicCorsPath,
  publicUrlRewriteMiddleware,
} from './bootstrap-app.js';

function run(mw: ReturnType<typeof hostAllowlistMiddleware>, hostHeader: string | undefined) {
  const req = { headers: { host: hostHeader } } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  const next = vi.fn() as NextFunction;
  mw(req, res, next);
  return { status, json, next };
}

describe('hostAllowlistMiddleware', () => {
  const mw = hostAllowlistMiddleware(['api.dev.example.com', 'mcp.dev.example.com']);

  it('passes through a host on the allow-list', () => {
    const { next, status } = run(mw, 'api.dev.example.com');
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('strips the port before matching', () => {
    const { next } = run(mw, 'api.dev.example.com:3101');
    expect(next).toHaveBeenCalledOnce();
  });

  it('matches case-insensitively', () => {
    const { next } = run(mw, 'API.DEV.example.com');
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a host not on the allow-list with 421', () => {
    const { status, json, next } = run(mw, 'muninclouddev920614ee-backend-dev.functions.fnc.nl-ams.scw.cloud');
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(421);
    expect(json).toHaveBeenCalledWith({ error: 'misdirected_request' });
  });

  it('rejects a missing host header with 421', () => {
    const { status, next } = run(mw, undefined);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(421);
  });

  it('always permits loopback hosts (in-process AgentHostRunner traffic)', () => {
    expect(run(mw, '127.0.0.1:3101').next).toHaveBeenCalledOnce();
    expect(run(mw, 'localhost:3001').next).toHaveBeenCalledOnce();
    expect(run(mw, '[::1]:3001').next).toHaveBeenCalledOnce();
  });
});

describe('isPublicCorsPath', () => {
  it('matches /mcp and sub-paths so claude.ai and other external MCP clients can call cross-origin', () => {
    expect(isPublicCorsPath('/mcp')).toBe(true);
    expect(isPublicCorsPath('/mcp/anything')).toBe(true);
  });

  it('matches OAuth + OIDC discovery + dynamic-client-registration helper endpoints', () => {
    expect(isPublicCorsPath('/.well-known/oauth-authorization-server')).toBe(true);
    expect(isPublicCorsPath('/.well-known/oauth-protected-resource')).toBe(true);
    expect(isPublicCorsPath('/.well-known/openid-configuration')).toBe(true);
    expect(isPublicCorsPath('/api/v1/oauth/clients/abc123')).toBe(true);
  });

  it('matches the widget bundle + ingest endpoints', () => {
    expect(isPublicCorsPath('/widget.js')).toBe(true);
    expect(isPublicCorsPath('/widget/abc.js')).toBe(true);
    expect(isPublicCorsPath('/api/v1/widget/messages')).toBe(true);
  });

  it('does not match the rest of the control plane', () => {
    expect(isPublicCorsPath('/api/v1/kb/spaces')).toBe(false);
    expect(isPublicCorsPath('/auth/sign-in')).toBe(false);
    expect(isPublicCorsPath('/healthz')).toBe(false);
  });
});

describe('publicUrlRewriteMiddleware', () => {
  const originalPublic = process.env.MUNIN_PUBLIC_URL;
  const originalApi = process.env.MUNIN_API_URL;

  beforeEach(() => {
    delete process.env.MUNIN_PUBLIC_URL;
    delete process.env.MUNIN_API_URL;
  });
  afterEach(() => {
    if (originalPublic === undefined) delete process.env.MUNIN_PUBLIC_URL;
    else process.env.MUNIN_PUBLIC_URL = originalPublic;
    if (originalApi === undefined) delete process.env.MUNIN_API_URL;
    else process.env.MUNIN_API_URL = originalApi;
  });

  function runMw(host: string, url: string): { url: string; nextCalled: boolean } {
    const req = { headers: { host }, url } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;
    publicUrlRewriteMiddleware()(req, res, next);
    return { url: (req as { url: string }).url, nextCalled: (next as { mock?: { calls: unknown[] } }).mock!.calls.length > 0 };
  }

  it('passes /mcp through unchanged on the OSS default URL', () => {
    process.env.MUNIN_PUBLIC_URL = 'http://localhost:3001/mcp';
    const out = runMw('localhost:3001', '/mcp');
    expect(out.url).toBe('/mcp');
    expect(out.nextCalled).toBe(true);
  });

  it('maps the root URL on the canonical MCP host to /mcp internally', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://mcp.getmunin.com';
    expect(runMw('mcp.getmunin.com', '/').url).toBe('/mcp');
    expect(runMw('mcp.getmunin.com', '/?session=abc').url).toBe('/mcp?session=abc');
    expect(runMw('mcp.getmunin.com', '').url).toBe('/mcp');
  });

  it('does NOT rewrite OAuth discovery or static asset paths on the canonical host', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://mcp.getmunin.com';
    expect(runMw('mcp.getmunin.com', '/.well-known/oauth-protected-resource').url).toBe(
      '/.well-known/oauth-protected-resource',
    );
    expect(runMw('mcp.getmunin.com', '/auth/oauth2/authorize?foo=1').url).toBe(
      '/auth/oauth2/authorize?foo=1',
    );
    expect(runMw('mcp.getmunin.com', '/favicon.ico').url).toBe('/favicon.ico');
  });

  it('leaves other hosts untouched (api.* should not be MCP-rewritten)', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://mcp.getmunin.com';
    expect(runMw('api.getmunin.com', '/').url).toBe('/');
    expect(runMw('api.getmunin.com', '/api/v1/kb/spaces').url).toBe('/api/v1/kb/spaces');
  });

  it('maps /v1/... on the canonical API host to /api/v1/... internally', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://mcp.getmunin.com';
    process.env.MUNIN_API_URL = 'https://api.getmunin.com/v1';
    expect(runMw('api.getmunin.com', '/v1/kb/spaces').url).toBe('/api/v1/kb/spaces');
    expect(runMw('api.getmunin.com', '/v1/kb/spaces?limit=10').url).toBe(
      '/api/v1/kb/spaces?limit=10',
    );
    expect(runMw('api.getmunin.com', '/v1').url).toBe('/api/v1');
  });

  it('still accepts legacy /api/v1/* requests on the canonical API host', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://mcp.getmunin.com';
    process.env.MUNIN_API_URL = 'https://api.getmunin.com/v1';
    // /api/v1 does not start with /v1/ — it starts with /api — so the
    // rewriter leaves it alone and the internal mount handles it as-is.
    expect(runMw('api.getmunin.com', '/api/v1/kb/spaces').url).toBe('/api/v1/kb/spaces');
  });

  it('does not match a path that just starts with the prefix as a substring', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://mcp.getmunin.com';
    process.env.MUNIN_API_URL = 'https://api.getmunin.com/v1';
    expect(runMw('api.getmunin.com', '/v1foo/bar').url).toBe('/v1foo/bar');
  });
});
