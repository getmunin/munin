import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { hashSecret, randomToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.ts';
import { BACKEND_BASE_CONTROLLERS, BACKEND_BASE_PROVIDERS, BACKEND_FEATURE_MODULES } from '../app.module.ts';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { MembershipHooksModule, type MembershipHookUser } from './membership-hooks.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run membership lifecycle tests.';

const hookCalls: MembershipHookUser[] = [];
const fallbackOrgIds: string[] = [];

@Module({
  imports: [
    ...BACKEND_FEATURE_MODULES,
    MembershipHooksModule.forRoot({
      afterLastMembershipRemoved: async (db, user) => {
        hookCalls.push(user);
        const [org] = await db
          .insert(schema.orgs)
          .values({ name: '' })
          .returning({ id: schema.orgs.id });
        fallbackOrgIds.push(org!.id);
        await db
          .insert(schema.orgMembers)
          .values({ orgId: org!.id, userId: user.id, role: 'owner', isDefault: true });
      },
    }),
  ],
  controllers: BACKEND_BASE_CONTROLLERS,
  providers: [...BACKEND_BASE_PROVIDERS, { provide: APP_GUARD, useExisting: AuthGuard }],
})
class GlobalGuardAppModule {}

(skipReason ? describe.skip : describe)(
  'membership lifecycle with AuthGuard as a global APP_GUARD and a last-membership hook',
  () => {
    let app: INestApplication;
    let baseUrl: string;
    let db: ReturnType<typeof createDb>;
    const orgIds: string[] = [];
    const userIds: string[] = [];

    beforeAll(async () => {
      process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
      process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
      process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
      process.env.MUNIN_MAIL_PROVIDER = 'stub';
      process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
      process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
      process.env.MUNIN_STORAGE_PROVIDER = 'local';

      await runMigrations(TEST_URL!);
      process.env.DATABASE_URL = TEST_URL!.replace(
        /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
        '$1munin_app:munin_app@',
      );
      db = createDb(TEST_URL!, { serviceRole: true });
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

      app = await createApp(GlobalGuardAppModule, { logger: false });
      await app.listen(0, '127.0.0.1');
      const address = (
        app.getHttpServer() as { address(): AddressInfo | string | null }
      ).address();
      if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      if (app) await app.close();
      if (db) {
        for (const id of [...orgIds, ...fallbackOrgIds]) {
          await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
        }
        for (const id of userIds) {
          await db.delete(schema.users).where(eq(schema.users.id, id));
        }
      }
    });

    async function seedOrg(label: string): Promise<{ orgId: string; ownerCookie: string }> {
      const [org] = await db
        .insert(schema.orgs)
        .values({ name: `Org ${label}` })
        .returning({ id: schema.orgs.id });
      orgIds.push(org!.id);
      const owner = await seedUser(`owner-${label}@example.com`);
      await db
        .insert(schema.orgMembers)
        .values({ orgId: org!.id, userId: owner.userId, role: 'owner', isDefault: true });
      return { orgId: org!.id, ownerCookie: owner.cookie };
    }

    async function seedUser(email: string): Promise<{ userId: string; cookie: string }> {
      const [user] = await db
        .insert(schema.users)
        .values({ email, name: 'Kari Nordmann' })
        .returning({ id: schema.users.id });
      userIds.push(user!.id);
      const token = randomToken(32);
      await db.insert(schema.sessions).values({
        userId: user!.id,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      return { userId: user!.id, cookie: `better-auth.session_token=${token}.sig` };
    }

    function removeMember(ownerCookie: string, userId: string): Promise<Response> {
      return fetch(`${baseUrl}/v1/orgs/me/members/${userId}`, {
        method: 'DELETE',
        headers: { cookie: ownerCookie },
      });
    }

    it('lets a signed-in user with no memberships accept an invitation past the global guard', async () => {
      const ts = Date.now();
      const { orgId } = await seedOrg(`accept-${ts}`);
      const email = `no-org-${ts}@example.com`;
      const token = randomToken(24);
      await db.insert(schema.orgInvitations).values({
        orgId,
        email,
        role: 'member',
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const { userId, cookie } = await seedUser(email);

      const res = await fetch(`${baseUrl}/v1/invitations/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ token }),
      });
      expect(res.status).toBe(200);
      const rows = await db
        .select()
        .from(schema.orgMembers)
        .where(eq(schema.orgMembers.userId, userId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ orgId, isDefault: true });
    });

    it('still rejects an accept with no session', async () => {
      const res = await fetch(`${baseUrl}/v1/invitations/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'whatever-token' }),
      });
      expect(res.status).toBe(403);
    });

    it('runs the hook in the removal transaction when the removed member has no memberships left', async () => {
      const ts = Date.now();
      const { orgId, ownerCookie } = await seedOrg(`last-${ts}`);
      const { userId } = await seedUser(`last-${ts}@example.com`);
      await db.insert(schema.orgMembers).values({ orgId, userId, role: 'member', isDefault: true });

      const res = await removeMember(ownerCookie, userId);
      expect(res.status).toBe(204);

      expect(hookCalls.map((u) => u.id)).toContain(userId);
      const rows = await db
        .select()
        .from(schema.orgMembers)
        .where(eq(schema.orgMembers.userId, userId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.orgId).not.toBe(orgId);
      expect(rows[0]).toMatchObject({ role: 'owner', isDefault: true });
    });

    it('skips the hook when the removed member still belongs to another org', async () => {
      const ts = Date.now();
      const first = await seedOrg(`keep-a-${ts}`);
      const second = await seedOrg(`keep-b-${ts}`);
      const { userId } = await seedUser(`keep-${ts}@example.com`);
      await db.insert(schema.orgMembers).values([
        { orgId: first.orgId, userId, role: 'member', isDefault: true },
        { orgId: second.orgId, userId, role: 'member', isDefault: false },
      ]);

      const res = await removeMember(first.ownerCookie, userId);
      expect(res.status).toBe(204);

      expect(hookCalls.map((u) => u.id)).not.toContain(userId);
      const rows = await db
        .select({ orgId: schema.orgMembers.orgId })
        .from(schema.orgMembers)
        .where(eq(schema.orgMembers.userId, userId));
      expect(rows).toEqual([{ orgId: second.orgId }]);
    });
  },
);
