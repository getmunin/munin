import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, getCurrentContext, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectorsService } from '../connectors/connectors.service.ts';
import { ConnectorRegistry } from '../connectors/connector.ts';
import type { ConnectorFetch } from '../connectors/http.ts';
import { GastroplannerAdapter } from './gastroplanner.adapter.ts';
import { BookingsService } from './bookings.service.ts';
import type { BookingEventInput } from './booking-events.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run bookings service tests.';

(skipReason ? describe.skip : describe)('BookingsService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let connectors: ConnectorsService;
  let bookings: BookingsService;
  let orgId: string;
  let adminActor: ActorIdentity;
  let endUserActor: ActorIdentity;
  let assertedEndUserActor: ActorIdentity;
  let noEmailEndUserId: string;
  let janeEndUserId: string;
  let janeContactId: string;
  let olaEndUserId: string;
  let olaContactId: string;
  let emailChannelId: string;
  let voiceChannelId: string;
  let displayId = 0;
  const recorded: BookingEventInput[] = [];

  type SeedMessage =
    | { author: 'end_user'; contactId: string; senderAuth?: string; provenEmail?: string }
    | { author: 'agent' };

  async function seedConversation(args: {
    channelId: string;
    endUserId: string;
    contactId: string;
    messages: SeedMessage[];
  }): Promise<string> {
    displayId += 1;
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId,
        channelId: args.channelId,
        contactId: args.contactId,
        endUserId: args.endUserId,
      })
      .returning();
    const base = Date.now() - 60_000;
    for (const [i, m] of args.messages.entries()) {
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: conv!.id,
        authorType: m.author,
        authorId: m.author === 'end_user' ? m.contactId : 'agt_test',
        body: 'hello',
        metadata:
          m.author === 'end_user' && m.senderAuth
            ? { senderAuth: m.senderAuth, ...(m.provenEmail ? { provenEmail: m.provenEmail } : {}) }
            : {},
        createdAt: new Date(base + i * 1000),
      });
    }
    return conv!.id;
  }

  async function mintToken(endUserId: string, metadata: Record<string, unknown>) {
    const [token] = await db
      .insert(schema.tokens)
      .values({
        orgId,
        type: 'delegated_end_user',
        tokenHash: randomUUID(),
        scopes: ['bookings:read', 'bookings:write'],
        audiences: ['self_service'],
        endUserId,
        metadata,
      })
      .returning();
    return new ActorIdentity(
      'end_user_agent',
      token!.id,
      orgId,
      ['bookings:read', 'bookings:write'],
      ['self_service'],
      endUserId,
      token!.id,
    );
  }

  function writerFor(endUserId: string, conversationId?: string): ActorIdentity {
    return new ActorIdentity(
      'end_user_agent',
      'tok_bookings_writer',
      orgId,
      ['bookings:read', 'bookings:write'],
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

  const calls: string[] = [];
  const bodies: Array<Record<string, unknown> | null> = [];
  let respond: (url: string) => { status?: number; body: unknown } = () => ({ body: [] });

  const stubFetch: ConnectorFetch = (url, init) => {
    calls.push(url);
    bodies.push(init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null);
    const { status = 200, body } = respond(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };

  const gastroplannerBooking = {
    id: 512,
    date: '2026-07-10',
    time: '19:00',
    seating_time: 120,
    pax: 4,
    customer_id: 7,
    status: 'confirmed',
    customer: { id: 7, first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
  };

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Bookings Service Test Org' })
      .returning();
    orgId = org!.id;
    const [eu] = await db
      .insert(schema.endUsers)
      .values({
        orgId,
        email: 'jane@example.com',
        name: 'Jane',
        metadata: { source: 'email-inbound', emailSource: 'channel' },
      })
      .returning();
    janeEndUserId = eu!.id;
    const [euNoEmail] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'anon-1' })
      .returning();
    noEmailEndUserId = euNoEmail!.id;
    const [euAsserted] = await db
      .insert(schema.endUsers)
      .values({
        orgId,
        externalId: 'email:ola@example.test',
        email: 'ola@example.test',
        metadata: { source: 'email-inbound', emailSource: 'channel' },
      })
      .returning();
    olaEndUserId = euAsserted!.id;

    const [emailChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'imap', name: 'support-email', config: {} })
      .returning();
    emailChannelId = emailChannel!.id;
    const [voiceChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'voice', vendor: 'vapi', name: 'support-voice', config: {} })
      .returning();
    voiceChannelId = voiceChannel!.id;
    const [janeContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: 'jane@example.com', endUserId: janeEndUserId })
      .returning();
    janeContactId = janeContact!.id;
    const [olaContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: 'ola@example.test', endUserId: olaEndUserId })
      .returning();
    olaContactId = olaContact!.id;
    const janeVerifiedConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [{ author: 'end_user', contactId: janeContactId, senderAuth: 'pass', provenEmail: 'jane@example.com' }],
    });
    const olaForgedConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: olaEndUserId,
      contactId: olaContactId,
      messages: [{ author: 'end_user', contactId: olaContactId, senderAuth: 'fail' }],
    });

    adminActor = new ActorIdentity('admin_agent', 'agt_bookings_test', orgId, ['*'], ['admin']);
    endUserActor = writerFor(janeEndUserId, janeVerifiedConversationId);
    assertedEndUserActor = writerFor(olaEndUserId, olaForgedConversationId);

    connectors = new ConnectorsService(new ConnectorRegistry([new GastroplannerAdapter(stubFetch)]));
    bookings = new BookingsService(connectors, { record: (event) => Promise.resolve(void recorded.push(event)) });
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    calls.length = 0;
    bodies.length = 0;
    recorded.length = 0;
    respond = () => ({ body: [gastroplannerBooking] });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM connector_connections WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = adminActor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      if (runAs.endUserId) {
        await tx.execute(sql`SELECT set_config('app.end_user_id', ${runAs.endUserId}, true)`);
      }
      const ctx: RequestContext = {
        db: tx,
        actor: runAs,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  function createConnection() {
    return run(() =>
      connectors.createConnection({
        vendor: 'gastroplanner',
        name: 'Restaurant',
        config: { apiToken: 'gp_partner_token', restaurantUri: 'bryggen-bistro' },
      }),
    );
  }

  it("resolves self-service lookups with the calling end-user's own email", async () => {
    await createConnection();

    const result = await run(() => bookings.getMyBookings({ limit: 5 }), endUserActor);

    expect(result.bookings[0]!.bookingRef).toBe('512');
    expect(result.bookings[0]!.partySize).toBe(4);
    expect(result.connection.vendor).toBe('gastroplanner');
    const url = new URL(calls[0]!);
    expect(url.searchParams.get('email')).toBe('jane@example.com');
  });

  it('refuses lookups for an end-user record without an email', async () => {
    await createConnection();
    const anonActor = new ActorIdentity(
      'end_user_agent',
      'tok_anon',
      orgId,
      ['bookings:read'],
      ['self_service'],
      noEmailEndUserId,
    );

    await expect(run(() => bookings.getMyBookings({ limit: 5 }), anonActor)).rejects.toThrow(
      /no email identity/,
    );
    expect(calls).toHaveLength(0);
  });

  it("reports not-found for another guest's booking", async () => {
    await createConnection();
    respond = () => ({
      body: [{ ...gastroplannerBooking, customer: { id: 8, email: 'mallory@example.com' } }],
    });

    await expect(
      run(() => bookings.getMyBooking({ bookingRef: '512' }), endUserActor),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects detail lookups without a ref or code', async () => {
    await createConnection();
    await expect(run(() => bookings.getMyBooking({}), endUserActor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("creates a self-service booking bound to the caller's own email", async () => {
    await createConnection();
    respond = (url) =>
      url.includes('/booking/v1/bookings')
        ? { body: { id: 987 } }
        : { body: [{ ...gastroplannerBooking, id: 987 }] };

    const result = await run(
      () => bookings.createMyBooking({ date: '2026-07-10', time: '19:00', partySize: 4 }),
      endUserActor,
    );

    expect(result.bookingRef).toBe('987');
    const createCall = calls.find((u) => u.includes('/booking/v1/bookings'));
    expect(createCall).toBeTruthy();
  });

  it('cancels the end-user’s own booking after an ownership check', async () => {
    await createConnection();
    respond = (url) =>
      url.includes('/cancel') ? { status: 204, body: undefined } : { body: [gastroplannerBooking] };

    const result = await run(() => bookings.cancelMyBooking({ bookingRef: '512' }), endUserActor);

    expect(result.cancelled).toBe(true);
    expect(calls.some((u) => u.includes('/booking/v1/bookings/512/cancel'))).toBe(true);
     expect(recorded).toEqual([
      expect.objectContaining({ name: 'booking.cancelled', email: 'jane@example.com', bookingRef: '512', vendor: 'gastroplanner' }),
    ]);
  });

  it("refuses to cancel another guest's booking and never calls cancel", async () => {
    await createConnection();
    respond = (url) =>
      url.includes('/cancel')
        ? { status: 204, body: undefined }
        : { body: [{ ...gastroplannerBooking, customer: { id: 8, email: 'mallory@example.com' } }] };

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), endUserActor),
    ).rejects.toThrow(NotFoundException);
    expect(calls.some((u) => u.includes('/cancel'))).toBe(false);
  });

  it('refuses reads when the latest message failed DMARC, since the reply can carry the data to whoever forged it', async () => {
    await createConnection();
    respond = () => ({
      body: [
        {
          ...gastroplannerBooking,
          customer: { id: 9, first_name: 'Ola', last_name: 'Nordmann', email: 'ola@example.test' },
        },
      ],
    });

    await expect(
      run(() => bookings.getMyBookings({ limit: 5 }), assertedEndUserActor),
    ).rejects.toThrow(/connectors_sender_auth_failed/);
    expect(calls).toHaveLength(0);
  });

  it('refuses reads when the latest message was forwarded', async () => {
    await createConnection();
    const forwardedConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [{ author: 'end_user', contactId: janeContactId, senderAuth: 'forwarded' }],
    });

    await expect(
      run(
        () => bookings.getMyBookings({ limit: 5 }),
        writerFor(janeEndUserId, forwardedConversationId),
      ),
    ).rejects.toThrow(/connectors_sender_forwarded/);
    expect(calls).toHaveLength(0);
  });

  const cancelResponds = (url: string) =>
    url.includes('/cancel') ? { status: 204, body: undefined } : { body: [gastroplannerBooking] };

  it('refuses to cancel when the latest message failed DMARC, and never reaches the vendor', async () => {
    await createConnection();
    respond = cancelResponds;

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), assertedEndUserActor),
    ).rejects.toThrow(/connectors_sender_auth_failed/);
    expect(calls).toHaveLength(0);
  });

  it('refuses to modify when the latest message failed DMARC, and never reaches the vendor', async () => {
    await createConnection();

    await expect(
      run(() => bookings.updateMyBooking({ bookingRef: '512', partySize: 2 }), assertedEndUserActor),
    ).rejects.toThrow(/connectors_sender_auth_failed/);
    expect(calls).toHaveLength(0);
  });

  it('refuses to create when the latest message failed DMARC, and never reaches the vendor', async () => {
    await createConnection();

    await expect(
      run(
        () => bookings.createMyBooking({ date: '2026-07-10', time: '19:00', partySize: 4 }),
        assertedEndUserActor,
      ),
    ).rejects.toThrow(/connectors_sender_auth_failed/);
    expect(calls).toHaveLength(0);
  });

  it('refuses when a failing message joins a passing one in the turn being answered', async () => {
    await createConnection();
    const mixedConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [
        { author: 'end_user', contactId: janeContactId, senderAuth: 'pass', provenEmail: 'jane@example.com' },
        { author: 'end_user', contactId: janeContactId, senderAuth: 'fail' },
      ],
    });

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(janeEndUserId, mixedConversationId),
      ),
    ).rejects.toThrow(/connectors_sender_auth_failed/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a booking write when the latest message names its sender only inside forwarded text', async () => {
    await createConnection();
    respond = cancelResponds;
    const forwardedConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [{ author: 'end_user', contactId: janeContactId, senderAuth: 'forwarded' }],
    });

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(janeEndUserId, forwardedConversationId),
      ),
    ).rejects.toThrow(/connectors_sender_forwarded/);
    expect(calls).toHaveLength(0);
  });

  it('cancels on email that carries no DMARC verdict, since nothing says it is forged', async () => {
    await createConnection();
    respond = cancelResponds;
    const unknownConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [{ author: 'end_user', contactId: janeContactId, senderAuth: 'unknown' }],
    });

    const result = await run(
      () => bookings.cancelMyBooking({ bookingRef: '512' }),
      writerFor(janeEndUserId, unknownConversationId),
    );

    expect(result.cancelled).toBe(true);
  });

  it('cancels once a genuine message follows an answered failure', async () => {
    await createConnection();
    respond = cancelResponds;
    const recoveredConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [
        { author: 'end_user', contactId: janeContactId, senderAuth: 'fail' },
        { author: 'agent' },
        { author: 'end_user', contactId: janeContactId, senderAuth: 'pass', provenEmail: 'jane@example.com' },
      ],
    });

    const result = await run(
      () => bookings.cancelMyBooking({ bookingRef: '512' }),
      writerFor(janeEndUserId, recoveredConversationId),
    );

    expect(result.cancelled).toBe(true);
  });

  it('cancels in a voice conversation, where caller id offers nothing to check', async () => {
    await createConnection();
    respond = cancelResponds;
    const voiceConversationId = await seedConversation({
      channelId: voiceChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [{ author: 'end_user', contactId: janeContactId }],
    });

    const result = await run(
      () => bookings.cancelMyBooking({ bookingRef: '512' }),
      writerFor(janeEndUserId, voiceConversationId),
    );

    expect(result.cancelled).toBe(true);
  });

  it('cancels for a caller that is not acting inside a conversation, such as a delegated token', async () => {
    await createConnection();
    respond = cancelResponds;
    const actor = await mintToken(janeEndUserId, {});

    const result = await run(() => bookings.cancelMyBooking({ bookingRef: '512' }), actor);

    expect(result.cancelled).toBe(true);
  });

  describe('guest bookings from a session without a verified email', () => {
    const guestEmail = 'kari@example.com';
    const callerPhone = '+4701234567';
    let callerEndUserId: string;
    let callerContactId: string;
    let nextRef = 900;

    beforeAll(async () => {
      const [caller] = await db
        .insert(schema.endUsers)
        .values({ orgId, externalId: `phone:${callerPhone}`, phone: callerPhone })
        .returning();
      callerEndUserId = caller!.id;
      const [contact] = await db
        .insert(schema.convContacts)
        .values({ orgId, phone: callerPhone, endUserId: callerEndUserId })
        .returning();
      callerContactId = contact!.id;
    });

    function callConversation(): Promise<string> {
      return seedConversation({
        channelId: voiceChannelId,
        endUserId: callerEndUserId,
        contactId: callerContactId,
        messages: [],
      });
    }

    function guestResponds(email = guestEmail) {
      const ref = ++nextRef;
      respond = (url) => {
        if (url.includes('/booking/v1/bookings') && url.endsWith('/cancel')) return { status: 204, body: undefined };
        if (url.includes('/booking/v1/bookings')) return { body: { id: ref } };
        return { body: [{ ...gastroplannerBooking, id: ref, customer: { id: 9, email } }] };
      };
      return String(ref);
    }

    const table = { date: '2026-07-10', time: '19:00', partySize: 2 };

    it('books under the guest email, defaults the phone to the caller, and records the booking on the conversation', async () => {
      await createConnection();
      const conversationId = await callConversation();
      const ref = guestResponds();

      const result = await run(
        () => bookings.createMyBooking({ ...table, email: ' Kari@Example.com ', name: 'Kari Nordmann' }),
        writerFor(callerEndUserId, conversationId),
      );

      expect(result.bookingRef).toBe(ref);
      const created = bodies[calls.findIndex((u) => u.endsWith('/booking/v1/bookings'))];
      expect(created?.customer).toMatchObject({ email: guestEmail, phone: callerPhone });
      const rows = await db
        .select()
        .from(schema.bookingsGuestBookings)
        .where(sql`conversation_id = ${conversationId}`);
      expect(rows.map((r) => [r.bookingRef, r.email])).toEqual([[ref, guestEmail]]);      expect(recorded).toEqual([expect.objectContaining({ name: 'booking.created', email: guestEmail, bookingRef: ref })]);
    });

    it('refuses without a guest email, and never reaches the vendor', async () => {
      await createConnection();
      const conversationId = await callConversation();

      await expect(
        run(() => bookings.createMyBooking(table), writerFor(callerEndUserId, conversationId)),
      ).rejects.toThrow(/bookings_invalid: .*pass the guest's email/);
      expect(calls).toHaveLength(0);
    });

    it('refuses outside a conversation, since there is nothing to record the booking on', async () => {
      await createConnection();

      await expect(
        run(() => bookings.createMyBooking({ ...table, email: guestEmail }), writerFor(callerEndUserId)),
      ).rejects.toThrow(/no conversation to book from/);
      expect(calls).toHaveLength(0);
    });

    it('stops at three bookings per conversation', async () => {
      await createConnection();
      const conversationId = await callConversation();
      const actor = writerFor(callerEndUserId, conversationId);
      for (let i = 0; i < 3; i++) {
        guestResponds();
        await run(() => bookings.createMyBooking({ ...table, email: guestEmail }), actor);
      }
      calls.length = 0;

      await expect(
        run(() => bookings.createMyBooking({ ...table, email: guestEmail }), actor),
      ).rejects.toThrow(/bookings_limit/);
      expect(calls).toHaveLength(0);
    });

    it('changes and cancels a booking made earlier in the same conversation', async () => {
      await createConnection();
      const conversationId = await callConversation();
      const actor = writerFor(callerEndUserId, conversationId);
      const ref = guestResponds();
      await run(() => bookings.createMyBooking({ ...table, email: guestEmail }), actor);

      const updated = await run(
        () => bookings.updateMyBooking({ bookingRef: ref, time: '20:00' }),
        actor,
      );
      const cancelled = await run(() => bookings.cancelMyBooking({ bookingRef: ref }), actor);

      expect(updated.updated).toBe(true);
      expect(cancelled.cancelled).toBe(true);
      expect(calls.some((u) => u.endsWith(`/booking/v1/bookings/${ref}/cancel`))).toBe(true);
    });

    it('cannot touch a booking it did not make in this conversation, even its own from another call', async () => {
      await createConnection();
      const firstCall = await callConversation();
      const ref = guestResponds();
      await run(
        () => bookings.createMyBooking({ ...table, email: guestEmail }),
        writerFor(callerEndUserId, firstCall),
      );
      const secondCall = writerFor(callerEndUserId, await callConversation());
      calls.length = 0;

      for (const bookingRef of [ref, '512']) {
        await expect(
          run(() => bookings.cancelMyBooking({ bookingRef }), secondCall),
        ).rejects.toThrow(/no email identity/);
      }
      expect(calls.some((u) => u.endsWith('/cancel'))).toBe(false);
    });

    it('refuses to cancel when the vendor no longer files the booking under the recorded email', async () => {
      await createConnection();
      const conversationId = await callConversation();
      const actor = writerFor(callerEndUserId, conversationId);
      const ref = guestResponds();
      await run(() => bookings.createMyBooking({ ...table, email: guestEmail }), actor);
      guestResponds('mallory@example.com');
      calls.length = 0;

      await expect(run(() => bookings.cancelMyBooking({ bookingRef: ref }), actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(calls.some((u) => u.endsWith('/cancel'))).toBe(false);
    });

    it('treats a visitor-typed email as no identity and books as a guest', async () => {
      await createConnection();
      const [visitor] = await db
        .insert(schema.endUsers)
        .values({
          orgId,
          externalId: `anon:${randomUUID()}`,
          email: 'typed@example.com',
          metadata: { anonymous: true, emailSource: 'visitor' },
        })
        .returning();
      const conversationId = await seedConversation({
        channelId: emailChannelId,
        endUserId: visitor!.id,
        contactId: janeContactId,
        messages: [],
      });
      const ref = guestResponds();

      const result = await run(
        () => bookings.createMyBooking({ ...table, email: guestEmail }),
        writerFor(visitor!.id, conversationId),
      );

      expect(result.bookingRef).toBe(ref);
    });

    it('lets a verified session book only under its own email', async () => {
      await createConnection();

      await expect(
        run(() => bookings.createMyBooking({ ...table, email: 'someone.else@example.com' }), endUserActor),
      ).rejects.toThrow(/cannot book under another address/);
      expect(calls).toHaveLength(0);
    });

    it('hides another end user\'s guest bookings from the database, not just the query', async () => {
      await createConnection();
      const conversationId = await callConversation();
      guestResponds();
      await run(
        () => bookings.createMyBooking({ ...table, email: guestEmail }),
        writerFor(callerEndUserId, conversationId),
      );

      const visible = await run(
        () =>
          getCurrentContext()
            .db.select()
            .from(schema.bookingsGuestBookings)
            .where(sql`conversation_id = ${conversationId}`),
        writerFor(janeEndUserId),
      );

      expect(visible).toHaveLength(0);
    });
  });
});
