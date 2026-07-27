import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { WebhookDispatcher } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { ConvService } from '../modules/conv/conv.service.ts';
import { ConversationClaimsService } from '../modules/conv/conv.claims.service.ts';
import { CuratorJobsService } from '../modules/curator/curator-jobs.service.ts';
import { AlertsService } from '../modules/system-alerts/system-alerts.service.ts';
import { InProcessMuninRestClientFactoryService } from './in-process-rest-client.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run in-process rest client tests.';

(skipReason ? describe.skip : describe)('InProcessMuninRestClientFactoryService', () => {
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'InProcess Client Test Org' })
      .returning();
    orgId = org!.id;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `inprocess-${Date.now()}@example.com`, name: 'Holder Human' })
      .returning();
    userId = user!.id;
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'Widget' })
      .returning();
    const [endUser] = await db
      .insert(schema.endUsers)
      .values({ orgId, email: 'visitor@example.com' })
      .returning();
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId: 1, channelId: channel!.id, endUserId: endUser!.id })
      .returning();
    conversationId = conversation!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.users).where(sql`id = ${userId}`);
    }
  });

  it('surfaces an active staff claim on getConversation', async () => {
    const dispatcher = new WebhookDispatcher();
    const claims = new ConversationClaimsService(dispatcher);
    const conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
    );
    const factory = new InProcessMuninRestClientFactoryService(
      db,
      conv,
      claims,
      new CuratorJobsService(dispatcher),
    );
    const client = factory.forOrg(orgId);

    const before = await client.getConversation(conversationId);
    expect(before.claim).toBeNull();

    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: conversationId,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const after = await client.getConversation(conversationId);
    expect(after.claim).toMatchObject({ holderType: 'user', holderId: userId });
  });
});
