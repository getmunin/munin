import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { hostAllowlistMiddleware, isPublicCorsPath } from './bootstrap-app.js';

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
