import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ActorIdentity, withContext, type ActorType, type RequestContext } from '@getmunin/core';
import { assertOwnerOrAdmin } from './role-guard.ts';

function makeActor(type: ActorType, opts: Partial<{ orgId: string; userId: string; id: string }> = {}): ActorIdentity {
  return new ActorIdentity(
    type,
    opts.id ?? `${type}_id`,
    opts.orgId ?? 'org_a',
    ['*'],
    ['admin'],
    undefined,
    undefined,
    undefined,
    opts.userId,
  );
}

function dbWithRole(role: string | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(role ? [{ role }] : []),
        }),
      }),
    }),
  } as unknown as RequestContext['db'];
}

function ctxFor(actor: ActorIdentity | undefined, role: string | null): RequestContext {
  return {
    db: dbWithRole(role),
    actor,
    correlationId: 'test',
  };
}

describe('assertOwnerOrAdmin', () => {
  it('throws when no actor is set', async () => {
    await expect(
      withContext(ctxFor(undefined, null), () => assertOwnerOrAdmin('org_a', 'u_x')),
    ).rejects.toThrow(ForbiddenException);
  });

  it('passes for system actors without role lookup', async () => {
    await expect(
      withContext(ctxFor(makeActor('system'), null), () => assertOwnerOrAdmin('org_a', 'u_x')),
    ).resolves.toBeUndefined();
  });

  it('passes for admin_agent actors without role lookup', async () => {
    await expect(
      withContext(ctxFor(makeActor('admin_agent'), null), () =>
        assertOwnerOrAdmin('org_a', 'agt_1'),
      ),
    ).resolves.toBeUndefined();
  });

  it('throws for widget_agent actors (no role bypass)', async () => {
    await expect(
      withContext(ctxFor(makeActor('widget_agent'), null), () =>
        assertOwnerOrAdmin('org_a', 'akey_1'),
      ),
    ).rejects.toThrow(/owner or admin user/);
  });

  it('throws for end_user_agent actors', async () => {
    await expect(
      withContext(ctxFor(makeActor('end_user_agent'), null), () =>
        assertOwnerOrAdmin('org_a', 'eu_1'),
      ),
    ).rejects.toThrow(/owner or admin user/);
  });

  it('throws for partner actors', async () => {
    await expect(
      withContext(ctxFor(makeActor('partner'), null), () =>
        assertOwnerOrAdmin('org_a', 'p_1'),
      ),
    ).rejects.toThrow(/owner or admin user/);
  });

  it('passes for user actor with owner role', async () => {
    await expect(
      withContext(ctxFor(makeActor('user'), 'owner'), () =>
        assertOwnerOrAdmin('org_a', 'user_id'),
      ),
    ).resolves.toBeUndefined();
  });

  it('passes for user actor with admin role', async () => {
    await expect(
      withContext(ctxFor(makeActor('user'), 'admin'), () =>
        assertOwnerOrAdmin('org_a', 'user_id'),
      ),
    ).resolves.toBeUndefined();
  });

  it('throws for user actor with member role', async () => {
    await expect(
      withContext(ctxFor(makeActor('user'), 'member'), () =>
        assertOwnerOrAdmin('org_a', 'user_id'),
      ),
    ).rejects.toThrow(/owners or admins/);
  });

  it('throws for user actor with no row in org', async () => {
    await expect(
      withContext(ctxFor(makeActor('user'), null), () =>
        assertOwnerOrAdmin('org_a', 'user_id'),
      ),
    ).rejects.toThrow(/owners or admins/);
  });
});

