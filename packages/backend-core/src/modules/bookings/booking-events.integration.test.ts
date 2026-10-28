import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ActorIdentity, WebhookDispatcher, withContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { ProductEventsService } from '../analytics/product-events.service.ts';
import { IdentityService } from '../identity/identity.service.ts';
import { JourneyEventSink } from '../journeys/journey-event.sink.ts';
import { BookingEventsService } from './booking-events.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run booking event tests.';

(skipReason ? describe.skip : describe)('Booking events', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let contactId: string;
  let service: BookingEventsService;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    const [contact] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Kari Nordmann', email: 'kari@kunde.test', consentLawfulBasis: 'contract' })
      .returning();
    contactId = contact!.id;
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'mail', active: true, config: {} })
      .returning();
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({ orgId, name: 'Bookings', brief: 'Booking follow-up', channelId: channel!.id, createdByActorType: 'user', createdByActorId: 'usr_1' })
      .returning();
    await db.insert(schema.journeys).values({
      orgId,
      name: 'Booking follow-up',
      status: 'live',
      outreachCampaignId: campaign!.id,
      createdByActorType: 'user',
      createdByActorId: 'usr_1',
    });
    appDb = createDb(TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@'));
    const webhooks = new WebhookDispatcher();
    webhooks.registerSink(new JourneyEventSink());
    service = new BookingEventsService(appDb, new ProductEventsService(webhooks, new IdentityService(webhooks)));
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    for (const table of ['journey_event_inbox', 'journeys', 'outreach_campaigns', 'conv_channels', 'analytics_product_events', 'events', 'crm_contacts', 'end_users']) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  });

  function callAs<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return withContext({ db: appDb, actor, correlationId: randomUUID() }, fn);
  }

  it('records a booking made by a guest in chat as a product event on their contact, ready for journeys', async () => {
    const guest = new ActorIdentity('widget_agent', 'wdg_test', orgId, ['bookings:write'], ['self_service']);
    await callAs(guest, () =>
      service.record({
        name: 'booking.created',
        email: 'kari@kunde.test',
        connectionId: 'con_test',
        vendor: 'gastroplanner',
        bookingRef: '512',
        booking: {
          bookingRef: '512',
          confirmationCode: 'ABC',
          status: 'confirmed',
          venue: 'Bryggen',
          startsAt: '2026-11-10T19:00:00',
          durationMinutes: 120,
          partySize: 4,
        },
      }),
    );

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [event] = await db
      .select()
      .from(schema.analyticsProductEvents)
      .where(and(eq(schema.analyticsProductEvents.orgId, orgId), eq(schema.analyticsProductEvents.name, 'booking.created')));
    expect(event).toMatchObject({ contactId });
    expect(event!.properties).toMatchObject({
      source: 'munin',
      vendor: 'gastroplanner',
      bookingRef: '512',
      via: 'self_service',
      startsAt: '2026-11-10T19:00:00',
      partySize: 4,
    });
    const inbox = await db
      .select({ type: schema.journeyEventInbox.type, payload: schema.journeyEventInbox.payload })
      .from(schema.journeyEventInbox)
      .where(eq(schema.journeyEventInbox.orgId, orgId));
    const recorded = inbox.find((row) => row.type === 'analytics.product_event.recorded');
    expect(recorded?.payload).toMatchObject({ name: 'booking.created', contactId });
  });

  it('never fails the caller when the event cannot be recorded', async () => {
    const broken = new BookingEventsService(appDb, { record: () => Promise.reject(new Error('down')) });
    const admin = new ActorIdentity('admin_agent', 'agt_test', orgId, ['*'], ['admin']);
    await expect(
      callAs(admin, () =>
        broken.record({ name: 'booking.cancelled', email: 'kari@kunde.test', connectionId: 'con_test', vendor: 'gastroplanner', bookingRef: '512', booking: null }),
      ),
    ).resolves.toBeUndefined();
  });
});
