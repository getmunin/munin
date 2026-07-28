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
  let channelId: string;
  let endUserId: string;

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
    channelId = channel!.id;
    endUserId = endUser!.id;
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


  async function freshConversation(displayId: number): Promise<string> {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [row] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId, channelId, endUserId })
      .returning();
    return row!.id;
  }

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

  it('carries message components through postAgentMessage into conv_messages.metadata', async () => {
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

    const components = [
      {
        type: 'product_list' as const,
        source: { connectionId: 'cnc_1', vendor: 'shopify', label: 'Shopify' },
        items: [
          {
            productRef: '7172723310627',
            title: 'Ladekabel Xplora 4 og Xplora X5 - Svart',
            imageUrl: 'https://cdn.shopify.com/s/files/1/x.jpg',
            url: null,
            currency: 'NOK',
            priceMin: '149.0',
            priceMax: '149.0',
          },
        ],
      },
    ];

    const target = await freshConversation(101);
    await client.postAgentMessage(target, 'Ja, vi har ladekabel.', { components });

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select({ body: schema.convMessages.body, metadata: schema.convMessages.metadata })
      .from(schema.convMessages)
      .where(sql`conversation_id = ${target} AND author_type = 'agent'`);
    const posted = rows.find((r) => r.body === 'Ja, vi har ladekabel.');
    expect(posted).toBeDefined();
    expect(posted!.metadata.components).toEqual(components);
  });

  it('leaves metadata empty when postAgentMessage carries no components', async () => {
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

    const target = await freshConversation(102);
    await client.postAgentMessage(target, 'Plain prose reply.', {});

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select({ body: schema.convMessages.body, metadata: schema.convMessages.metadata })
      .from(schema.convMessages)
      .where(sql`conversation_id = ${target} AND author_type = 'agent'`);
    const posted = rows.find((r) => r.body === 'Plain prose reply.');
    expect(posted!.metadata.components).toBeUndefined();
  });
});
