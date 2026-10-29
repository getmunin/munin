import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductEventsService } from './product-events.service.ts';
import { IdentityService } from '../identity/identity.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { AddressDeliverabilityService } from '../crm/address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run product event tests.';

(skipReason ? describe.skip : describe)('ProductEventsService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: ProductEventsService;
  let crm: CrmService;
  let orgId: string;
  let otherOrgId: string;
  let agent: ActorIdentity;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    const [other] = await db.insert(schema.orgs).values({ name: 'Other' }).returning();
    otherOrgId = other!.id;
    agent = new ActorIdentity('admin_agent', 'agt_events_test', orgId, ['*'], ['admin']);
    const webhooks = new WebhookDispatcher();
    svc = new ProductEventsService(webhooks, new IdentityService(webhooks));
    crm = new CrmService(webhooks, new DefaultQuotasService(), new AddressDeliverabilityService());
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id IN (${orgId}, ${otherOrgId})`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    for (const table of [
      'analytics_product_events',
      'events',
      'crm_segments',
      'crm_contacts',
      'end_users',
    ]) {
      await db.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE org_id IN (${orgId}, ${otherOrgId})`,
      );
    }
  });

  function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${as.orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: as, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }
  const asAgent = <T>(fn: () => Promise<T>) => runAs(agent, fn);

  async function contact(values: { name: string; email: string; endUserId?: string }) {
    const [row] = await db
      .insert(schema.crmContacts)
      .values({ orgId, consentLawfulBasis: 'contract', ...values })
      .returning();
    return row!;
  }

  it('records an event against an existing contact and emits it on the event stream', async () => {
    const kari = await contact({ name: 'Kari Nordmann', email: 'kari@acme.test' });
    const [result] = await asAgent(() =>
      svc.record([
        {
          id: 'evt-1',
          name: 'trial.started',
          identity: { contactId: kari.id },
          properties: { plan: 'pro' },
        },
      ]),
    );
    expect(result).toMatchObject({ status: 'recorded', contactId: kari.id });

    const emitted = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'analytics.product_event.recorded')));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.payload).toMatchObject({
      name: 'trial.started',
      contactId: kari.id,
      externalEventId: 'evt-1',
      properties: { plan: 'pro' },
    });
  });

  it('is idempotent on the caller event id and does not emit twice', async () => {
    const kari = await contact({ name: 'Kari Nordmann', email: 'kari@acme.test' });
    const event = { id: 'evt-dup', name: 'trial.started', identity: { contactId: kari.id } };
    const [first] = await asAgent(() => svc.record([event]));
    const [second] = await asAgent(() => svc.record([event]));
    expect(first!.status).toBe('recorded');
    expect(second).toMatchObject({ status: 'duplicate', eventId: first!.eventId });

    const rows = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'analytics.product_event.recorded')));
    expect(rows).toHaveLength(1);
  });

  it('resolves an email identity to an end user and the matching contact', async () => {
    const ola = await contact({ name: 'Ola Nordmann', email: 'Ola@Acme.test' });
    const [result] = await asAgent(() =>
      svc.record([{ id: 'evt-2', name: 'teammate.invited', identity: { email: 'ola@acme.test' } }]),
    );
    expect(result!.contactId).toBe(ola.id);
    expect(result!.endUserId).toMatch(/^eu_/);
  });

  it('rejects a contact id from another organization', async () => {
    const [foreign] = await db
      .insert(schema.crmContacts)
      .values({ orgId: otherOrgId, name: 'Foreign', email: 'foreign@other.test' })
      .returning();
    await expect(
      asAgent(() =>
        svc.record([{ id: 'evt-3', name: 'trial.started', identity: { contactId: foreign!.id } }]),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses event names that would impersonate Munin events', async () => {
    await expect(
      asAgent(() => svc.record([{ id: 'x1', name: 'conversation.message.received', identity: { email: 'ola@kunde.test' } }])),
    ).rejects.toThrow(/reserved/);
  });

  it('lists event names with counts', async () => {
    const kari = await contact({ name: 'Kari Nordmann', email: 'kari@acme.test' });
    await asAgent(() =>
      svc.record([
        { id: 'a', name: 'trial.started', identity: { contactId: kari.id } },
        { id: 'b', name: 'report.exported', identity: { contactId: kari.id } },
        { id: 'c', name: 'report.exported', identity: { contactId: kari.id } },
      ]),
    );
    const names = await asAgent(() => svc.listEventNames());
    expect(names.map((n) => [n.name, n.count])).toEqual([
      ['report.exported', 2],
      ['trial.started', 1],
    ]);
  });

  it('filters segment members by whether a product event occurred', async () => {
    const kari = await contact({ name: 'Kari Nordmann', email: 'kari@acme.test' });
    const ola = await contact({ name: 'Ola Nordmann', email: 'ola@acme.test' });
    await asAgent(() =>
      svc.record([
        { id: 'k1', name: 'teammate.invited', identity: { contactId: kari.id } },
        {
          id: 'o1',
          name: 'teammate.invited',
          identity: { contactId: ola.id },
          occurredAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
        },
      ]),
    );

    const ids = async (filter: Parameters<CrmService['createSegment']>[0]['filter']) =>
      asAgent(async () => {
        const segment = await crm.createSegment({ name: `s-${randomUUID()}`, filter });
        const members = await crm.listContactsInSegment({ id: segment.id });
        return members.map((m) => m.id).sort();
      });

    expect(await ids({ events: [{ name: 'teammate.invited', occurred: true }] })).toEqual(
      [kari.id, ola.id].sort(),
    );
    expect(
      await ids({ events: [{ name: 'teammate.invited', occurred: true, withinDays: 14 }] }),
    ).toEqual([kari.id]);
    expect(
      await ids({ events: [{ name: 'teammate.invited', occurred: false, withinDays: 14 }] }),
    ).toEqual([ola.id]);
    expect(
      await ids({ events: [{ name: 'teammate.invited', occurred: true, minCount: 2 }] }),
    ).toEqual([]);
  });

  it('matches events recorded against the end user once the contact is linked to it', async () => {
    const [endUser] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'acct-42' })
      .returning();
    const kari = await contact({
      name: 'Kari Nordmann',
      email: 'kari@acme.test',
      endUserId: endUser!.id,
    });
    await asAgent(() =>
      svc.record([{ id: 'x1', name: 'trial.started', identity: { externalId: 'acct-42' } }]),
    );
    const members = await asAgent(async () => {
      const segment = await crm.createSegment({
        name: 'trialists',
        filter: { events: [{ name: 'trial.started', occurred: true }] },
      });
      return crm.listContactsInSegment({ id: segment.id });
    });
    expect(members.map((m) => m.id)).toEqual([kari.id]);
  });

  it('refuses to delete a segment that a broadcast still references', async () => {
    const segment = await asAgent(() =>
      crm.createSegment({ name: 'news', filter: { tagsAny: ['customer'] } }),
    );
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'news', active: true, config: {} })
      .returning();
    await db.insert(schema.outreachBroadcasts).values({
      orgId,
      name: 'October news',
      segmentId: segment.id,
      channelId: channel!.id,
      subject: 'News',
      contentFormat: 'markdown',
      body: 'Hello',
      proposedByActorType: 'admin_agent',
      proposedByActorId: 'agt_events_test',
    });
    await expect(asAgent(() => crm.deleteSegment(segment.id))).rejects.toThrow(ConflictException);
    await db.execute(sql`DELETE FROM outreach_broadcasts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`);
  });
});
