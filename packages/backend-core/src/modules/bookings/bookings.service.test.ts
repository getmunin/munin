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
  let noEmailEndUserId: string;

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
    number_of_guests: 4,
    status: 'confirmed',
    note: null,
    confirmation_code: 'GP-7F3K',
    venue: { name: 'Bryggen Bistro' },
    customer: { email: 'jane@example.com' },
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
      .values({ orgId, email: 'jane@example.com', name: 'Jane' })
      .returning();
    const [euNoEmail] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'anon-1' })
      .returning();
    noEmailEndUserId = euNoEmail!.id;

    adminActor = new ActorIdentity('admin_agent', 'agt_bookings_test', orgId, ['*'], ['admin']);
    endUserActor = new ActorIdentity(
      'end_user_agent',
      'tok_bookings_test',
      orgId,
      ['bookings:read'],
      ['self_service'],
      eu!.id,
    );

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
        config: { apiToken: 'gp_partner_token' },
      }),
    );
  }

  it("resolves self-service lookups with the calling end-user's own email", async () => {
    await createConnection();

    const result = await run(() => bookings.getMyBookings({ limit: 5 }), endUserActor);

    expect(result.bookings[0]!.confirmationCode).toBe('GP-7F3K');
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
      body: [{ ...gastroplannerBooking, customer: { email: 'mallory@example.com' } }],
    });

    await expect(
      run(() => bookings.getMyBooking({ confirmationCode: 'GP-7F3K' }), endUserActor),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects detail lookups without a ref or code', async () => {
    await createConnection();
    await expect(run(() => bookings.getMyBooking({}), endUserActor)).rejects.toThrow(
      BadRequestException,
    );
  });
});
