import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectorsService } from '../connectors/connectors.service.ts';
import { ConnectorRegistry } from '../connectors/connector.ts';
import type { ConnectorFetch } from '../connectors/http.ts';
import { GastroplannerAdapter } from './gastroplanner.adapter.ts';
import { BookingsService } from './bookings.service.ts';

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
  let chatChannelId: string;
  let displayId = 0;

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

  async function mintToken(endUserId: string, metadata: Record<string, unknown>, revoked = false) {
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
        revokedAt: revoked ? new Date() : null,
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
  let respond: (url: string) => { status?: number; body: unknown } = () => ({ body: [] });

  const stubFetch: ConnectorFetch = (url) => {
    calls.push(url);
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
        metadata: { source: 'email-inbound' },
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
        metadata: { source: 'email-inbound' },
      })
      .returning();
    olaEndUserId = euAsserted!.id;

    const [emailChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'imap', name: 'support-email', config: {} })
      .returning();
    emailChannelId = emailChannel!.id;
    const [chatChannel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'support-chat',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();
    chatChannelId = chatChannel!.id;
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
    bookings = new BookingsService(connectors);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    calls.length = 0;
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

  it('still allows reads on a channel-asserted identity, whose reply can only reach the real mailbox', async () => {
    await createConnection();
    respond = () => ({
      body: [
        {
          ...gastroplannerBooking,
          customer: { id: 9, first_name: 'Ola', last_name: 'Nordmann', email: 'ola@example.test' },
        },
      ],
    });

    const result = await run(() => bookings.getMyBookings({ limit: 5 }), assertedEndUserActor);

    expect(result.bookings).toHaveLength(1);
  });

  it('refuses to cancel on a channel-asserted identity and never reaches the vendor', async () => {
    await createConnection();
    respond = (url) =>
      url.includes('/cancel') ? { status: 204, body: undefined } : { body: [gastroplannerBooking] };

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), assertedEndUserActor),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses to modify on a channel-asserted identity and never reaches the vendor', async () => {
    await createConnection();

    await expect(
      run(() => bookings.updateMyBooking({ bookingRef: '512', partySize: 2 }), assertedEndUserActor),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses to create on a channel-asserted identity and never reaches the vendor', async () => {
    await createConnection();

    await expect(
      run(
        () => bookings.createMyBooking({ date: '2026-07-10', time: '19:00', partySize: 4 }),
        assertedEndUserActor,
      ),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it("refuses a forged conversation even while the same address has a verified one elsewhere", async () => {
    await createConnection();
    const forgedConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [{ author: 'end_user', contactId: janeContactId, senderAuth: 'fail' }],
    });

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(janeEndUserId, forgedConversationId),
      ),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses when a forgery joins a verified message in the turn being answered', async () => {
    await createConnection();
    const mixedConversationId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [
        { author: 'end_user', contactId: janeContactId, senderAuth: 'pass', provenEmail: 'jane@example.com' },
        { author: 'end_user', contactId: janeContactId, senderAuth: 'unknown' },
      ],
    });

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(janeEndUserId, mixedConversationId),
      ),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses once a forgery follows an answered, verified turn', async () => {
    await createConnection();
    const laterForgeryId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [
        { author: 'end_user', contactId: janeContactId, senderAuth: 'pass', provenEmail: 'jane@example.com' },
        { author: 'agent' },
        { author: 'end_user', contactId: janeContactId, senderAuth: 'fail' },
      ],
    });

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(janeEndUserId, laterForgeryId),
      ),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a caller that is not acting inside a conversation', async () => {
    await createConnection();

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), writerFor(janeEndUserId)),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it("refuses to borrow another end user's verified conversation", async () => {
    await createConnection();

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(olaEndUserId, endUserActor.conversationId),
      ),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a verdict stamped on a message outside the email channel', async () => {
    await createConnection();
    const chatConversationId = await seedConversation({
      channelId: chatChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [{ author: 'end_user', contactId: janeContactId, senderAuth: 'pass', provenEmail: 'jane@example.com' }],
    });

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(janeEndUserId, chatConversationId),
      ),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a pass whose proven address is not the booking address', async () => {
    await createConnection();
    const otherAddressId = await seedConversation({
      channelId: emailChannelId,
      endUserId: janeEndUserId,
      contactId: janeContactId,
      messages: [
        { author: 'end_user', contactId: janeContactId, senderAuth: 'pass', provenEmail: 'kari@example.test' },
      ],
    });

    await expect(
      run(
        () => bookings.cancelMyBooking({ bookingRef: '512' }),
        writerFor(janeEndUserId, otherAddressId),
      ),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('cancels through a delegated token the organization minted for the booking address', async () => {
    await createConnection();
    respond = (url) =>
      url.includes('/cancel') ? { status: 204, body: undefined } : { body: [gastroplannerBooking] };
    const actor = await mintToken(janeEndUserId, { attestedEmail: 'jane@example.com' });

    const result = await run(() => bookings.cancelMyBooking({ bookingRef: '512' }), actor);

    expect(result.cancelled).toBe(true);
  });

  it('refuses a delegated token minted without an attested email', async () => {
    await createConnection();
    const actor = await mintToken(janeEndUserId, {});

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), actor),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a delegated token attested for a different address than the end user carries', async () => {
    await createConnection();
    const actor = await mintToken(janeEndUserId, { attestedEmail: 'kari@example.test' });

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), actor),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a revoked delegated token', async () => {
    await createConnection();
    const actor = await mintToken(janeEndUserId, { attestedEmail: 'jane@example.com' }, true);

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), actor),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });

  it('prefers the conversation over the token when the actor carries both', async () => {
    await createConnection();
    const token = await mintToken(olaEndUserId, { attestedEmail: 'ola@example.test' });
    const actor = new ActorIdentity(
      'end_user_agent',
      token.id,
      orgId,
      ['bookings:read', 'bookings:write'],
      ['self_service'],
      olaEndUserId,
      token.tokenId,
      undefined,
      undefined,
      undefined,
      undefined,
      assertedEndUserActor.conversationId,
    );

    await expect(
      run(() => bookings.cancelMyBooking({ bookingRef: '512' }), actor),
    ).rejects.toThrow(/connectors_unproven/);
    expect(calls).toHaveLength(0);
  });
});

