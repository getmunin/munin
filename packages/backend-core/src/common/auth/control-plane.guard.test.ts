import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { ResolvedCredential } from '@getmunin/core';
import { ControlPlaneGuard } from './control-plane.guard.ts';

function makeCtx(credential?: ResolvedCredential) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ credential }) }),
  } as never;
}

function actor(overrides: Partial<{ type: string; scopes: string[]; audiences: string[] }>) {
  const a = {
    type: 'user',
    scopes: ['*'],
    audiences: ['admin'],
    ...overrides,
  };
  return {
    ...a,
    hasScope: (s: string) => a.scopes.includes(s) || a.scopes.includes('*'),
    hasAudience: (aud: string) => a.audiences.includes(aud),
  } as never;
}

describe('ControlPlaneGuard', () => {
  it('rejects unauthenticated requests', () => {
    const guard = new ControlPlaneGuard();
    expect(() => guard.canActivate(makeCtx())).toThrow(UnauthorizedException);
  });

  it('admits a session-cookie user (no audience on credential)', () => {
    const guard = new ControlPlaneGuard();
    const cred = { actor: actor({ type: 'user' }) } as ResolvedCredential;
    expect(guard.canActivate(makeCtx(cred))).toBe(true);
  });

  it('rejects an OAuth-derived user actor (credential has MCP audience)', () => {
    const guard = new ControlPlaneGuard();
    const cred = {
      actor: actor({ type: 'user' }),
      audience: 'https://api.example.com/mcp',
    } as ResolvedCredential;
    expect(() => guard.canActivate(makeCtx(cred))).toThrow(ForbiddenException);
  });

  it('admits an admin_agent with admin audience and wildcard scope', () => {
    const guard = new ControlPlaneGuard();
    const cred = {
      actor: actor({ type: 'admin_agent', scopes: ['*'], audiences: ['admin'] }),
    } as ResolvedCredential;
    expect(guard.canActivate(makeCtx(cred))).toBe(true);
  });

  it('rejects an admin_agent without admin audience', () => {
    const guard = new ControlPlaneGuard();
    const cred = {
      actor: actor({ type: 'admin_agent', scopes: ['*'], audiences: ['self_service'] }),
    } as ResolvedCredential;
    expect(() => guard.canActivate(makeCtx(cred))).toThrow(ForbiddenException);
  });

  it('rejects an admin_agent without wildcard scope', () => {
    const guard = new ControlPlaneGuard();
    const cred = {
      actor: actor({ type: 'admin_agent', scopes: ['kb:read'], audiences: ['admin'] }),
    } as ResolvedCredential;
    expect(() => guard.canActivate(makeCtx(cred))).toThrow(ForbiddenException);
  });

  it('rejects widget_agent, end_user_agent, and other actor types', () => {
    const guard = new ControlPlaneGuard();
    for (const type of ['widget_agent', 'end_user_agent', 'partner']) {
      const cred = { actor: actor({ type }) } as ResolvedCredential;
      expect(() => guard.canActivate(makeCtx(cred))).toThrow(ForbiddenException);
    }
  });
});
