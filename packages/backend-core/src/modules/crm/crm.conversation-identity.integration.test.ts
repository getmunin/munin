import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildAdminAgentActor,
  withContext,
  WebhookDispatcher,
  type ActorIdentity,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CrmService } from './crm.service.ts';
import { AddressDeliverabilityService } from './address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { applyTenancyGUCs } from '../../common/tenancy/tenancy.interceptor.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CRM conversation-identity tests.';

(skipReason ? describe.skip : describe)('CrmService.applyConversationIdentity', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: CrmService;
  let orgId: string;
  let actor: ActorIdentity;
  let channelId: string;
  let displayId = 0;

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await applyTenancyGUCs(tx, actor);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function endUser(values: {
    email?: string;
    phone?: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const [row] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: `eu-${randomUUID()}`, ...values })
      .returning();
    return row!.id;
  }

  async function conversation(
    endUserId: string | null,
    messageMetadata: Array<Record<string, unknown>> = [{}],
  ): Promise<string> {
    displayId += 1;
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId })
      .returning();
    const [conv] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId, channelId, contactId: contact!.id, endUserId })
      .returning();
    for (const metadata of messageMetadata) {
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: conv!.id,
        authorType: 'end_user',
        authorId: contact!.id,
        body: 'hello',
        metadata,
      });
    }
    return conv!.id;
  }

  async function contact(values: Partial<typeof schema.crmContacts.$inferInsert>) {
    const [row] = await db
      .insert(schema.crmContacts)
      .values({ orgId, ...values })
      .returning();
    return row!;
  }

  async function reload(id: string) {
    const [row] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, id));
    return row!;
  }

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    svc = new CrmService(new WebhookDispatcher(), new DefaultQuotasService(), new AddressDeliverabilityService());

    const [org] = await db.insert(schema.orgs).values({ name: 'CRM Conversation Identity Org' }).returning();
    orgId = org!.id;
    actor = buildAdminAgentActor(orgId);
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'imap', name: 'support-email', config: {} })
      .returning();
    channelId = channel!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  it('never touches a contact that is not linked to the conversation, whatever the message claims', async () => {
    const victim = await contact({
      name: 'Kari Nordmann',
      email: 'kari.ceo@globex.example',
      phone: '+4712345678',
      tags: ['vip'],
      doNotContact: true,
    });
    const visitor = await endUser({});
    const conversationId = await conversation(visitor);

    const result = await run(() =>
      svc.applyConversationIdentity({
        conversationId,
        name: 'Ola Nordmann',
        email: 'kari.ceo@globex.example',
        phone: '+47 12 34 56 78',
        title: 'Chief Executive',
      }),
    );

    expect(result.action).toBe('created');
    expect(result.contactId).not.toBe(victim.id);
    const after = await reload(victim.id);
    expect(after.name).toBe('Kari Nordmann');
    expect(after.title).toBeNull();
    expect(after.endUserId).toBeNull();
    expect(after.tags).toEqual(['vip']);
    expect(after.doNotContact).toBe(true);
  });

  it('fills only empty fields on the linked contact and never overwrites existing values', async () => {
    const visitor = await endUser({});
    const linked = await contact({
      endUserId: visitor,
      name: 'Kari Nordmann',
      phone: '+4701234567',
      tags: ['customer'],
    });
    const conversationId = await conversation(visitor);

    const result = await run(() =>
      svc.applyConversationIdentity({
        conversationId,
        name: 'Somebody Else',
        phone: '+4709876543',
        title: 'Head of Operations',
      }),
    );

    expect(result).toEqual({ action: 'filled', contactId: linked.id, fields: ['title'] });
    const after = await reload(linked.id);
    expect(after.name).toBe('Kari Nordmann');
    expect(after.phone).toBe('+4701234567');
    expect(after.title).toBe('Head of Operations');
    expect(after.tags).toEqual(['customer']);
  });

  it('keeps a self-reported email or phone off an existing contact and off the new one', async () => {
    const existing = await contact({
      name: 'Kari Nordmann',
      email: 'kari@globex.example',
      phone: '+4712340000',
    });
    const visitor = await endUser({
      email: 'kari@globex.example',
      metadata: { emailSource: 'visitor' },
    });
    const conversationId = await conversation(visitor);

    const result = await run(() =>
      svc.applyConversationIdentity({
        conversationId,
        name: 'Kari N',
        email: 'Kari@globex.example',
        phone: '+47 1234 0000',
      }),
    );

    expect(result.action).toBe('created');
    expect(result.fields).toEqual(['name']);
    const created = await reload(result.contactId!);
    expect(created.email).toBeNull();
    expect(created.phone).toBeNull();
    expect(created.endUserId).toBe(visitor);
    expect(created.tags).toEqual(['from-chat']);
    const after = await reload(existing.id);
    expect(after.name).toBe('Kari Nordmann');
    expect(after.endUserId).toBeNull();
  });

  it('records a self-reported email no other contact holds on the conversation’s own new contact', async () => {
    const visitor = await endUser({});
    const conversationId = await conversation(visitor);

    const result = await run(() =>
      svc.applyConversationIdentity({ conversationId, email: 'lead@initech.example' }),
    );

    expect(result.action).toBe('created');
    const created = await reload(result.contactId!);
    expect(created.email).toBe('lead@initech.example');
    expect(created.endUserId).toBe(visitor);
  });

  it('backfills the existing contact that matches an email the conversation proved', async () => {
    const existing = await contact({ email: 'Ola@Acme.example', phone: '+4701110000' });
    const sender = await endUser({
      email: 'ola@acme.example',
      metadata: { emailSource: 'channel' },
    });
    const conversationId = await conversation(sender, [
      { senderAuth: 'pass', provenEmail: 'ola@acme.example' },
    ]);

    const result = await run(() =>
      svc.applyConversationIdentity({
        conversationId,
        name: 'Ola Nordmann',
        phone: '+4702220000',
        title: 'CTO',
      }),
    );

    expect(result).toEqual({
      action: 'filled',
      contactId: existing.id,
      fields: ['endUserId', 'name', 'title'],
    });
    const after = await reload(existing.id);
    expect(after.endUserId).toBe(sender);
    expect(after.name).toBe('Ola Nordmann');
    expect(after.title).toBe('CTO');
    expect(after.phone).toBe('+4701110000');
  });

  it('creates a contact carrying the proven email when no contact matches it yet', async () => {
    const sender = await endUser({
      email: 'per@hooli.example',
      metadata: { emailSource: 'channel' },
    });
    const conversationId = await conversation(sender, [{ senderAuth: 'pass' }]);

    const result = await run(() =>
      svc.applyConversationIdentity({ conversationId, name: 'Per Nordmann' }),
    );

    expect(result.action).toBe('created');
    const created = await reload(result.contactId!);
    expect(created.email).toBe('per@hooli.example');
    expect(created.name).toBe('Per Nordmann');
    expect(created.endUserId).toBe(sender);
  });

  it.each([
    ['failed DMARC', 'fail'],
    ['arrived forwarded', 'forwarded'],
  ])('treats the sender as unproven when a message %s', async (_label, senderAuth) => {
    const address = `${senderAuth}@umbrella.example`;
    const existing = await contact({ email: address });
    const sender = await endUser({ email: address, metadata: { emailSource: 'channel' } });
    const conversationId = await conversation(sender, [{ senderAuth: 'pass' }, { senderAuth }]);

    const result = await run(() =>
      svc.applyConversationIdentity({ conversationId, name: 'Forged Name' }),
    );

    expect(result.contactId).not.toBe(existing.id);
    expect((await reload(existing.id)).name).toBeNull();
    expect((await reload(result.contactId!)).email).toBeNull();
  });

  it('skips automated senders and records only the email of a role account', async () => {
    const bot = await endUser({ email: 'news@initech.example', metadata: { emailSource: 'channel' } });
    const automated = await conversation(bot, [{ senderClassification: { isMailingList: true } }]);
    const skipped = await run(() =>
      svc.applyConversationIdentity({ conversationId: automated, name: 'Newsletter' }),
    );
    expect(skipped).toEqual({
      action: 'skipped',
      contactId: null,
      fields: [],
      reason: 'automated_sender',
    });

    const inbox = await endUser({ email: 'support@initech.example', metadata: { emailSource: 'channel' } });
    const shared = await conversation(inbox, [{ senderClassification: { isRoleAccount: true } }]);
    const result = await run(() =>
      svc.applyConversationIdentity({
        conversationId: shared,
        name: 'Kari Nordmann',
        phone: '+4703330000',
        title: 'Support lead',
      }),
    );
    expect(result.action).toBe('created');
    expect(result.fields).toEqual(['email']);
    const created = await reload(result.contactId!);
    expect(created.email).toBe('support@initech.example');
    expect(created.name).toBeNull();
    expect(created.phone).toBeNull();
    expect(created.tags).toEqual(['from-chat', 'role-account']);
  });

  it('skips a conversation without an end-user and refuses an unknown conversation', async () => {
    const anonymous = await conversation(null);
    expect(
      await run(() => svc.applyConversationIdentity({ conversationId: anonymous, name: 'Ola' })),
    ).toEqual({ action: 'skipped', contactId: null, fields: [], reason: 'no_end_user' });
    await expect(
      run(() => svc.applyConversationIdentity({ conversationId: 'ccv_missing', name: 'Ola' })),
    ).rejects.toThrow(/crm_not_found/);
  });
});
