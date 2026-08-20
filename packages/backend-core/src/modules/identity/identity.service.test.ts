import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, WebhookDispatcher, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { IdentityService } from './identity.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run identity service tests.';

(skipReason ? describe.skip : describe)('IdentityService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: IdentityService;
  let orgId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Identity Service Test Org' }).returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_identity_test', orgId, ['*'], ['admin']);
    svc = new IdentityService(new WebhookDispatcher());
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM analytics_visitor_identities WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM end_users WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function seedEndUser(values: Partial<typeof schema.endUsers.$inferInsert> = {}) {
    const [row] = await db
      .insert(schema.endUsers)
      .values({ orgId, ...values })
      .returning();
    return row!;
  }

  async function countEndUsers(): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.endUsers)
      .where(sql`org_id = ${orgId}`);
    return rows[0]!.n;
  }

  describe('resolve', () => {
    it('matches on email and reports matchedOn', async () => {
      const eu = await seedEndUser({ email: 'jane@acme.com', name: 'Jane' });
      const res = await run(() => svc.resolve({ email: 'jane@acme.com' }));
      expect(res.endUserId).toBe(eu.id);
      expect(res.matchedOn).toBe('email');
      expect(res.name).toBe('Jane');
    });

    it('matches an email that differs only in case', async () => {
      const eu = await seedEndUser({ email: 'jane@acme.com' });
      const res = await run(() => svc.resolve({ email: 'JANE@Acme.COM' }));
      expect(res.endUserId).toBe(eu.id);
      expect(res.matchedOn).toBe('email');
    });

    it('matches on externalId, phone and visitorId', async () => {
      const byExternal = await seedEndUser({ externalId: 'ext-1' });
      const byPhone = await seedEndUser({ phone: '+4755500001' });
      const byVisitor = await seedEndUser({ externalId: 'ext-2' });
      await db
        .insert(schema.analyticsVisitorIdentities)
        .values({ orgId, visitorId: 'vis-1', endUserId: byVisitor.id });

      expect(await run(() => svc.resolve({ externalId: 'ext-1' }))).toMatchObject({
        endUserId: byExternal.id,
        matchedOn: 'external-id',
      });
      expect(await run(() => svc.resolve({ phone: '+4755500001' }))).toMatchObject({
        endUserId: byPhone.id,
        matchedOn: 'phone',
      });
      expect(await run(() => svc.resolve({ visitorId: 'vis-1' }))).toMatchObject({
        endUserId: byVisitor.id,
        matchedOn: 'visitor-id',
      });
    });

    it('prefers externalId over email when both are supplied and they disagree', async () => {
      const byExternal = await seedEndUser({ externalId: 'ext-1' });
      await seedEndUser({ email: 'other@acme.com' });
      const res = await run(() => svc.resolve({ externalId: 'ext-1', email: 'other@acme.com' }));
      expect(res.endUserId).toBe(byExternal.id);
      expect(res.matchedOn).toBe('external-id');
    });

    it('returns a null match without inserting an end user', async () => {
      const before = await countEndUsers();
      const res = await run(() => svc.resolve({ email: 'nobody@nowhere.test' }));
      expect(res.endUserId).toBeNull();
      expect(res.matchedOn).toBeNull();
      expect(await countEndUsers()).toBe(before);
    });

    it('reports crmContactId as null for an end user the CRM pass has not reached', async () => {
      await seedEndUser({ email: 'jane@acme.com' });
      const res = await run(() => svc.resolve({ email: 'jane@acme.com' }));
      expect(res.endUserId).not.toBeNull();
      expect(res.crmContactId).toBeNull();
    });

    it('surfaces crmContactId once a CRM contact links to the end user', async () => {
      const eu = await seedEndUser({ email: 'jane@acme.com' });
      const [contact] = await db
        .insert(schema.crmContacts)
        .values({ orgId, email: 'jane@acme.com', endUserId: eu.id })
        .returning();
      const res = await run(() => svc.resolve({ email: 'jane@acme.com' }));
      expect(res.crmContactId).toBe(contact!.id);
    });

    it('does not resolve an end user belonging to another org', async () => {
      const [other] = await db.insert(schema.orgs).values({ name: 'Other Org' }).returning();
      await db.insert(schema.endUsers).values({ orgId: other!.id, email: 'elsewhere@acme.com' });
      try {
        const res = await run(() => svc.resolve({ email: 'elsewhere@acme.com' }));
        expect(res.endUserId).toBeNull();
      } finally {
        await db.delete(schema.orgs).where(sql`id = ${other!.id}`);
      }
    });
  });

  describe('profile', () => {
    it('summarises channels, conversation count and linked records', async () => {
      const eu = await seedEndUser({ email: 'jane@acme.com', name: 'Jane' });
      const [channel] = await db
        .insert(schema.convChannels)
        .values({ orgId, type: 'email', name: 'Inbox', vendor: 'imap' })
        .returning();
      await db.insert(schema.convConversations).values([
        { orgId, displayId: 1, channelId: channel!.id, endUserId: eu.id, lastMessageAt: new Date('2026-01-01') },
        { orgId, displayId: 2, channelId: channel!.id, endUserId: eu.id, lastMessageAt: new Date('2026-02-01') },
      ]);
      const [convContact] = await db
        .insert(schema.convContacts)
        .values({ orgId, email: 'jane@acme.com', endUserId: eu.id })
        .returning();
      await db
        .insert(schema.analyticsVisitorIdentities)
        .values({ orgId, visitorId: 'vis-1', endUserId: eu.id });

      const profile = await run(() => svc.profile(eu.id));
      expect(profile.channels).toEqual(['email']);
      expect(profile.conversationCount).toBe(2);
      expect(profile.lastConversationAt).toBe(new Date('2026-02-01').toISOString());
      expect(profile.visitorIds).toEqual(['vis-1']);
      expect(profile.convContactId).toBe(convContact!.id);
      expect(profile.crmContactId).toBeNull();
      expect(profile.viewEventCount).toBe(0);
      expect(profile.searchEventCount).toBe(0);
    });

    it('returns empty aggregates for an end user with no activity', async () => {
      const eu = await seedEndUser({ email: 'quiet@acme.com' });
      const profile = await run(() => svc.profile(eu.id));
      expect(profile.channels).toEqual([]);
      expect(profile.conversationCount).toBe(0);
      expect(profile.lastConversationAt).toBeNull();
      expect(profile.visitorIds).toEqual([]);
    });

    it('throws NotFound for an unknown end user', async () => {
      await expect(run(() => svc.profile('eu_does_not_exist'))).rejects.toThrow(NotFoundException);
    });
  });
});
