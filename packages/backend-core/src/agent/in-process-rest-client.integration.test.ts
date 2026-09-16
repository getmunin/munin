import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { WebhookDispatcher } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { ConvService } from '../modules/conv/conv.service.ts';
import { ConversationClaimsService } from '../modules/conv/conv.claims.service.ts';
import { CuratorJobsService } from '../modules/curator/curator-jobs.service.ts';
import { AlertsService } from '../modules/system-alerts/system-alerts.service.ts';
import { InProcessMuninRestClientFactoryService } from './in-process-rest-client.ts';
import { stubAttachmentGateway } from '../modules/conv/attachments/conv-attachments.test-stub.ts';

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
      stubAttachmentGateway(),
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

  it('carries the email Subject line through getConversation', async () => {
    const dispatcher = new WebhookDispatcher();
    const claims = new ConversationClaimsService(dispatcher);
    const conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
      stubAttachmentGateway(),
    );
    const factory = new InProcessMuninRestClientFactoryService(
      db,
      conv,
      claims,
      new CuratorJobsService(dispatcher),
    );
    const client = factory.forOrg(orgId);

    const target = await freshConversation(104);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db
      .update(schema.convConversations)
      .set({ subject: 'Double charge on invoice 4471' })
      .where(sql`id = ${target}`);

    const detail = await client.getConversation(target);
    expect(detail.subject).toBe('Double charge on invoice 4471');
  });

  it('carries message components through postAgentMessage into conv_messages.metadata', async () => {
    const dispatcher = new WebhookDispatcher();
    const claims = new ConversationClaimsService(dispatcher);
    const conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
      stubAttachmentGateway(),
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
            title: 'Ladekabel Acme 4 og Acme X5 - Svart',
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

  it('carries hydrated message attachments through getConversation and toRuntimeHistory', async () => {
    const dispatcher = new WebhookDispatcher();
    const claims = new ConversationClaimsService(dispatcher);
    const hydrated = {
      id: 'cva_inprocess1',
      name: 'receipt.png',
      mime: 'image/png',
      sizeBytes: 2048,
      width: 800,
      height: 600,
      thumbnailWidth: 320,
      inline: false,
      cid: null,
      deleted: false,
      url: 'https://assets.example.com/receipt.png',
      thumbnailUrl: 'https://assets.example.com/receipt-thumb.png',
    };
    const conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
      { ...stubAttachmentGateway(), hydrateRaw: () => [hydrated] },
    );
    const factory = new InProcessMuninRestClientFactoryService(
      db,
      conv,
      claims,
      new CuratorJobsService(dispatcher),
    );
    const client = factory.forOrg(orgId);

    const target = await freshConversation(103);
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId: target,
      authorType: 'end_user',
      authorId: endUserId,
      body: '',
    });

    const detail = await client.getConversation(target);
    expect(detail.messages[0]!.attachments).toEqual([hydrated]);

    const history = client.toRuntimeHistory(detail);
    expect(history[0]!.attachments).toEqual([
      { mime: 'image/png', url: 'https://assets.example.com/receipt.png', name: 'receipt.png' },
    ]);
  });

  it('carries inbound message metadata through getConversation into the runtime history', async () => {
    const dispatcher = new WebhookDispatcher();
    const claims = new ConversationClaimsService(dispatcher);
    const conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
      stubAttachmentGateway(),
    );
    const factory = new InProcessMuninRestClientFactoryService(
      db,
      conv,
      claims,
      new CuratorJobsService(dispatcher),
    );
    const client = factory.forOrg(orgId);

    const target = await freshConversation(107);
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId: target,
      authorType: 'end_user',
      authorId: endUserId,
      body: 'Dette stemmer ikke. Moderat nivå?',
      metadata: {
        quotedThread: [
          {
            from: 'Globex <support@globex.test>',
            to: null,
            date: 'tirsdag 15. september 2026 13:23',
            subject: 'Din månedsoppdatering',
            body: 'Nivået ditt denne måneden er moderat.',
          },
        ],
      },
    });

    const detail = await client.getConversation(target);
    const history = client.toRuntimeHistory(detail);
    expect(history[0]!.quotedHistory).toEqual([
      {
        from: 'Globex <support@globex.test>',
        date: 'tirsdag 15. september 2026 13:23',
        subject: 'Din månedsoppdatering',
        body: 'Nivået ditt denne måneden er moderat.',
      },
    ]);
  });

  it('leaves metadata empty when postAgentMessage carries no components', async () => {
    const dispatcher = new WebhookDispatcher();
    const claims = new ConversationClaimsService(dispatcher);
    const conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
      stubAttachmentGateway(),
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
