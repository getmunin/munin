import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { hostAllowlistMiddleware } from './bootstrap-app.js';

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
