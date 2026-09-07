import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Db } from '@getmunin/db';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedCredential } from '@getmunin/core';
import { ControlPlaneGuard, MEMBER_FORBIDDEN_CODE } from './control-plane.guard.ts';

function makeCtx(credential?: ResolvedCredential) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ credential }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
}

function reflector(allowMember = false): Reflector {
  return { getAllAndOverride: () => allowMember } as unknown as Reflector;
}

function unusedDb(): Db {
  return {
    execute: () => {
      throw new Error('db must not be queried when the actor already carries its org role');
    },
  } as unknown as Db;
}

function dbReturningRole(role: string | null): Db {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(role === null ? [] : [{ role }]),
        }),
      }),
    }),
  } as unknown as Db;
}

function actor(
  overrides: Partial<{
    type: string;
    scopes: string[];
    audiences: string[];
    orgRole: string;
    orgId: string;
    userId: string;
  }>,
) {
  const a = {
    type: 'user',
    scopes: ['*'],
    audiences: ['admin'],
    orgRole: 'owner',
    orgId: 'org_1',
    userId: 'usr_1',
    id: 'usr_1',
    ...overrides,
  };
  return {
    ...a,
    hasScope: (s: string) => a.scopes.includes(s) || a.scopes.includes('*'),
    hasAudience: (aud: string) => a.audiences.includes(aud),
  } as never;
}

function guard(opts: { allowMember?: boolean; db?: Db } = {}): ControlPlaneGuard {
  return new ControlPlaneGuard(reflector(opts.allowMember ?? false), opts.db ?? unusedDb());
}

describe('ControlPlaneGuard', () => {
  it('rejects unauthenticated requests', async () => {
    await expect(guard().canActivate(makeCtx())).rejects.toThrow(UnauthorizedException);
  });

  it('admits an owner on a session cookie (no audience on credential)', async () => {
    const cred = { actor: actor({ orgRole: 'owner' }) } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).resolves.toBe(true);
  });

  it('admits an admin on a session cookie', async () => {
    const cred = { actor: actor({ orgRole: 'admin' }) } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).resolves.toBe(true);
  });

  it('rejects an OAuth-derived user actor (credential has MCP audience)', async () => {
    const cred = {
      actor: actor({}),
      audience: 'https://api.example.com/mcp',
    } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a member on a route that does not opt in', async () => {
    const cred = { actor: actor({ orgRole: 'member' }) } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).rejects.toThrow(ForbiddenException);
  });

  it('carries a translatable code so the dashboard can explain the refusal', async () => {
    const cred = { actor: actor({ orgRole: 'member' }) } as ResolvedCredential;
    await guard()
      .canActivate(makeCtx(cred))
      .then(
        () => expect.unreachable('member should not pass'),
        (err: ForbiddenException) => {
          expect((err.getResponse() as { code: string }).code).toBe(MEMBER_FORBIDDEN_CODE);
        },
      );
  });

  it('admits a member on a route marked @AllowMember()', async () => {
    const cred = { actor: actor({ orgRole: 'member' }) } as ResolvedCredential;
    await expect(guard({ allowMember: true }).canActivate(makeCtx(cred))).resolves.toBe(true);
  });

  it('rejects a role it does not recognize, so a new role starts closed', async () => {
    const cred = { actor: actor({ orgRole: 'analyst' }) } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).rejects.toThrow(ForbiddenException);
  });

  it('reads the role from the database when the credential does not carry one', async () => {
    const cred = { actor: actor({ orgRole: undefined }) } as ResolvedCredential;
    await expect(
      guard({ db: dbReturningRole('admin') }).canActivate(makeCtx(cred)),
    ).resolves.toBe(true);
  });

  it('rejects a user whose membership is gone', async () => {
    const cred = { actor: actor({ orgRole: undefined }) } as ResolvedCredential;
    await expect(
      guard({ db: dbReturningRole(null) }).canActivate(makeCtx(cred)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('admits an admin_agent with admin audience and wildcard scope', async () => {
    const cred = {
      actor: actor({ type: 'admin_agent', scopes: ['*'], audiences: ['admin'] }),
    } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).resolves.toBe(true);
  });

  it('rejects an admin_agent without admin audience', async () => {
    const cred = {
      actor: actor({ type: 'admin_agent', scopes: ['*'], audiences: ['self_service'] }),
    } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).rejects.toThrow(ForbiddenException);
  });

  it('rejects an admin_agent without wildcard scope', async () => {
    const cred = {
      actor: actor({ type: 'admin_agent', scopes: ['kb:read'], audiences: ['admin'] }),
    } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).rejects.toThrow(ForbiddenException);
  });

  it('admits a system actor', async () => {
    const cred = { actor: actor({ type: 'system' }) } as ResolvedCredential;
    await expect(guard().canActivate(makeCtx(cred))).resolves.toBe(true);
  });

  it('rejects widget_agent, end_user_agent, and other actor types', async () => {
    for (const type of ['widget_agent', 'end_user_agent', 'partner']) {
      const cred = { actor: actor({ type }) } as ResolvedCredential;
      await expect(guard().canActivate(makeCtx(cred))).rejects.toThrow(ForbiddenException);
    }
  });
});
