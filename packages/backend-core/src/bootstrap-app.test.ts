import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  corsMiddleware,
  hostAllowlistMiddleware,
  isPublicCorsPath,
  publicUrlRewriteMiddleware,
} from './bootstrap-app.ts';

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
    expect(isPublicCorsPath('/v1/oauth/clients/abc123')).toBe(true);
  });

  it('matches the widget bundle + ingest endpoints', () => {
    expect(isPublicCorsPath('/widget.js')).toBe(true);
    expect(isPublicCorsPath('/widget/abc.js')).toBe(true);
    expect(isPublicCorsPath('/v1/widget/messages')).toBe(true);
  });

  it('does not match the rest of the control plane', () => {
    expect(isPublicCorsPath('/v1/kb/spaces')).toBe(false);
    expect(isPublicCorsPath('/auth/sign-in')).toBe(false);
    expect(isPublicCorsPath('/healthz')).toBe(false);
  });
});

describe('corsMiddleware', () => {
  function runCors(
    strict: string[] | true,
    init: { method?: string; path: string; origin?: string },
  ): { headers: Record<string, string>; status: number | null; nextCalled: boolean } {
    const headers: Record<string, string> = {};
    let status: number | null = null;
    const req = {
      method: init.method ?? 'GET',
      path: init.path,
      headers: init.origin ? { origin: init.origin } : {},
    } as unknown as Request;
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      status: (code: number) => {
        status = code;
        return { end: () => undefined };
      },
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    corsMiddleware(strict)(req, res, next);
    return { headers, status, nextCalled: (next as { mock?: { calls: unknown[] } }).mock!.calls.length > 0 };
  }

  it('reflects strict-origin requests with credentials', () => {
    const { headers } = runCors(['https://app.example.com'], {
      path: '/v1/kb/spaces',
      origin: 'https://app.example.com',
    });
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('does NOT set Allow-Credentials on /mcp even when origin is reflected', () => {
    const { headers } = runCors(['https://app.example.com'], {
      path: '/mcp',
      origin: 'https://evil.example',
    });
    expect(headers['Access-Control-Allow-Origin']).toBe('https://evil.example');
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('does NOT set Allow-Credentials on other public CORS paths', () => {
    for (const path of ['/widget.js', '/v1/widget/messages', '/.well-known/oauth-authorization-server']) {
      const { headers } = runCors(['https://app.example.com'], {
        path,
        origin: 'https://anything.example',
      });
      expect(headers['Access-Control-Allow-Origin']).toBe('https://anything.example');
      expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    }
  });

  it('rejects strict-only paths from non-allowlisted origins (no CORS headers set)', () => {
    const { headers } = runCors(['https://app.example.com'], {
      path: '/v1/kb/spaces',
      origin: 'https://evil.example',
    });
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('publicUrlRewriteMiddleware', () => {
  const originalPublic = process.env.NEXT_PUBLIC_MCP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_MCP_URL;
  });
  afterEach(() => {
    if (originalPublic === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalPublic;
  });

  function runMw(host: string, url: string): { url: string; nextCalled: boolean } {
    const req = { headers: { host }, url } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;
    publicUrlRewriteMiddleware()(req, res, next);
    return { url: (req as { url: string }).url, nextCalled: (next as { mock?: { calls: unknown[] } }).mock!.calls.length > 0 };
  }

  it('passes /mcp through unchanged on the OSS default URL', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'http://localhost:3001/mcp';
    const out = runMw('localhost:3001', '/mcp');
    expect(out.url).toBe('/mcp');
    expect(out.nextCalled).toBe(true);
  });

  it('maps the root URL on the canonical MCP host to /mcp internally', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.getmunin.com';
    expect(runMw('mcp.getmunin.com', '/').url).toBe('/mcp');
    expect(runMw('mcp.getmunin.com', '/?session=abc').url).toBe('/mcp?session=abc');
    expect(runMw('mcp.getmunin.com', '').url).toBe('/mcp');
  });

  it('does NOT rewrite OAuth discovery or static asset paths on the canonical host', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.getmunin.com';
    expect(runMw('mcp.getmunin.com', '/.well-known/oauth-protected-resource').url).toBe(
      '/.well-known/oauth-protected-resource',
    );
    expect(runMw('mcp.getmunin.com', '/auth/oauth2/authorize?foo=1').url).toBe(
      '/auth/oauth2/authorize?foo=1',
    );
    expect(runMw('mcp.getmunin.com', '/favicon.ico').url).toBe('/favicon.ico');
  });

  it('leaves other hosts untouched (api.* should not be MCP-rewritten)', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.getmunin.com';
    expect(runMw('api.getmunin.com', '/').url).toBe('/');
    expect(runMw('api.getmunin.com', '/v1/kb/spaces').url).toBe('/v1/kb/spaces');
  });

});
