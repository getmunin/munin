import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ActorIdentity, withContext, type ActorType, type RequestContext } from '@getmunin/core';
import { assertOwner, assertOwnerOrAdmin, resolveAgentRole } from './role-guard.ts';

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

  it('passes for a creatorless admin_agent, which is capped at admin, without role lookup', async () => {
    await expect(
      withContext(ctxFor(makeActor('admin_agent'), null), () =>
        assertOwnerOrAdmin('org_a', 'agt_1'),
      ),
    ).resolves.toBeUndefined();
  });

  it('passes for an admin_agent whose creator is still an admin', async () => {
    await expect(
      withContext(ctxFor(makeActor('admin_agent', { userId: 'u_creator' }), 'admin'), () =>
        assertOwnerOrAdmin('org_a', 'u_creator'),
      ),
    ).resolves.toBeUndefined();
  });

  it('throws for an admin_agent whose creator was demoted to member', async () => {
    await expect(
      withContext(ctxFor(makeActor('admin_agent', { userId: 'u_creator' }), 'member'), () =>
        assertOwnerOrAdmin('org_a', 'u_creator'),
      ),
    ).rejects.toThrow(/owners or admins/);
  });

  it('throws for an admin_agent whose creator is no longer a member', async () => {
    await expect(
      withContext(ctxFor(makeActor('admin_agent', { userId: 'u_creator' }), null), () =>
        assertOwnerOrAdmin('org_a', 'u_creator'),
      ),
    ).rejects.toThrow(/no longer a member/);
  });

  it('throws for admin_agent with a scoped key (no "*")', async () => {
    const scoped = new ActorIdentity(
      'admin_agent',
      'k_scoped',
      'org_a',
      ['kb:read'],
      ['admin'],
    );
    await expect(
      withContext(ctxFor(scoped, null), () => assertOwnerOrAdmin('org_a', 'k_scoped')),
    ).rejects.toThrow(/scoped admin keys/);
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

describe('assertOwner', () => {
  it('passes for an admin_agent whose creator is an owner', async () => {
    await expect(
      withContext(ctxFor(makeActor('admin_agent', { userId: 'u_owner' }), 'owner'), () =>
        assertOwner('org_a', 'u_owner'),
      ),
    ).resolves.toBeUndefined();
  });

  it('throws for an admin_agent whose creator is only an admin', async () => {
    await expect(
      withContext(ctxFor(makeActor('admin_agent', { userId: 'u_admin' }), 'admin'), () =>
        assertOwner('org_a', 'u_admin'),
      ),
    ).rejects.toThrow(/only org owners/);
  });

  it('throws for a scoped admin_agent even when its creator is an owner', async () => {
    const scoped = new ActorIdentity(
      'admin_agent',
      'k_scoped',
      'org_a',
      ['kb:read'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      'u_owner',
    );
    await expect(
      withContext(ctxFor(scoped, 'owner'), () => assertOwner('org_a', 'u_owner')),
    ).rejects.toThrow(/scoped admin keys/);
  });
});

describe('resolveAgentRole', () => {
  it('caps a creatorless "*" key at admin without reading any role', async () => {
    let reads = 0;
    const role = await resolveAgentRole(makeActor('admin_agent'), () => {
      reads += 1;
      return Promise.resolve('owner');
    });
    expect(role).toBe('admin');
    expect(reads).toBe(0);
  });

  it('returns the creator\'s current role for a "*" key', async () => {
    const role = await resolveAgentRole(
      makeActor('admin_agent', { userId: 'u_creator' }),
      (userId) => Promise.resolve(userId === 'u_creator' ? 'owner' : null),
    );
    expect(role).toBe('owner');
  });
});

