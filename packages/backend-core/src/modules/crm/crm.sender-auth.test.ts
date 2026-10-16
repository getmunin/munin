import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ActorIdentity, withContext, WebhookDispatcher, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CrmService } from './crm.service.ts';
import { AddressDeliverabilityService } from './address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CRM sender-auth tests.';

(skipReason ? describe.skip : describe)('CrmService.getMyVerifiedContact on an email conversation', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: CrmService;
  let orgId: string;
  let endUserId: string;
  let contactId: string;
  let channelId: string;
  let displayId = 0;

  async function conversationWithLatestTurn(senderAuth: string): Promise<string> {
    displayId += 1;
    const [conv] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId, channelId, contactId, endUserId })
      .returning();
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId: conv!.id,
      authorType: 'end_user',
      authorId: contactId,
      body: 'what is my phone number on file?',
      metadata:
        senderAuth === 'pass'
          ? { senderAuth, provenEmail: 'kari@example.com' }
          : { senderAuth },
    });
    return conv!.id;
  }

  function endUserIn(conversationId: string): ActorIdentity {
    return new ActorIdentity(
      'end_user_agent',
      'tok_crm_sender_auth',
      orgId,
      ['crm:read', 'crm:write'],
      ['self_service'],
      endUserId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      conversationId,
    );
  }

  function run<T>(fn: () => Promise<T>, actor: ActorIdentity): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${actor.orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', ${actor.endUserId!}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    svc = new CrmService(new WebhookDispatcher(), new DefaultQuotasService(), new AddressDeliverabilityService());

    const [org] = await db.insert(schema.orgs).values({ name: 'CRM Sender Auth Test Org' }).returning();
    orgId = org!.id;
    const [eu] = await db
      .insert(schema.endUsers)
      .values({
        orgId,
        externalId: 'email:kari@example.com',
        email: 'kari@example.com',
        metadata: { source: 'email-inbound', emailSource: 'channel' },
      })
      .returning();
    endUserId = eu!.id;
    await db.insert(schema.crmContacts).values({
      orgId,
      endUserId,
      email: 'kari@example.com',
      name: 'Kari Nordmann',
      phone: '+4701234567',
    });
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'imap', name: 'support-email', config: {} })
      .returning();
    channelId = channel!.id;
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: 'kari@example.com', endUserId })
      .returning();
    contactId = contact!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  it('returns the contact when the latest message passed DMARC', async () => {
    const conversationId = await conversationWithLatestTurn('pass');
    const contact = await run(() => svc.getMyVerifiedContact(), endUserIn(conversationId));
    expect(contact.name).toBe('Kari Nordmann');
  });

  it.each([
    ['failed DMARC', 'fail', /crm_sender_auth_failed/],
    ['was forwarded', 'forwarded', /crm_sender_forwarded/],
  ])(
    'refuses the contact when the latest message %s, so a forged sender cannot have it sent back out',
    async (_label, senderAuth, refusal) => {
      const conversationId = await conversationWithLatestTurn(senderAuth);
      await expect(
        run(() => svc.getMyVerifiedContact(), endUserIn(conversationId)),
      ).rejects.toThrow(refusal);
    },
  );
});
