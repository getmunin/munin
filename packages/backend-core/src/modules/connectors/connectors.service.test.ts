import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  getCurrentContext,
  SsrfBlockedError,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';
import { ConnectorsService } from './connectors.service.ts';
import {
  ConnectorRegistry,
  type ConnectorAdapter,
  type ConnectorConnectionContext,
  type ConnectorDomain,
  type ConnectorTestResult,
} from './connector.ts';
import { ConnectorVendorError } from './http.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run connectors service tests.';

/**
 * Vendor-free fake covering the full adapter contract: one secret field
 * (apiToken) and one plain field (host), so encryption round-trips and
 * secret-retention-on-update are exercised without any real vendor code.
 */
class FakeAdapter implements ConnectorAdapter {
  test: (ctx: ConnectorConnectionContext) => Promise<ConnectorTestResult> = () =>
    Promise.resolve({ ok: true, detail: 'connected' });

  readonly displayName: string;
  readonly configInput = z.object({
    host: z.string().min(1),
    apiToken: z.string().min(1).optional(),
  });
  readonly configFields = [
    { key: 'host', label: 'Host', required: true },
    { key: 'apiToken', label: 'API token', required: true, secret: true },
  ];

  constructor(
    readonly vendor: string,
    readonly domain: ConnectorDomain,
  ) {
    this.displayName = vendor;
  }

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = input.apiToken as string | undefined;
    if (!token && !previous?.encryptedApiToken) {
      throw new ConnectorVendorError('apiToken is required');
    }
    return {
      host: input.host,
      encryptedApiToken: token ? await encryptSecret(token) : previous!.encryptedApiToken,
    };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    return { host: stored.host };
  }

  testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    return this.test(ctx);
  }
}

(skipReason ? describe.skip : describe)('ConnectorsService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let connectors: ConnectorsService;
  let shopAdapter: FakeAdapter;
  let orgId: string;
  let adminActor: ActorIdentity;
  let endUserId: string;
  let endUserActor: ActorIdentity;
  let noEmailEndUserId: string;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Connectors Service Test Org' })
      .returning();
    orgId = org!.id;
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, email: 'jane@example.com', name: 'Jane' })
      .returning();
    endUserId = eu!.id;
    const [euNoEmail] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'anon-1' })
      .returning();
    noEmailEndUserId = euNoEmail!.id;

    adminActor = new ActorIdentity('admin_agent', 'agt_connectors_test', orgId, ['*'], ['admin']);
    endUserActor = new ActorIdentity(
      'end_user_agent',
      'tok_connectors_test',
      orgId,
      ['commerce:read', 'bookings:read'],
      ['self_service'],
      endUserId,
    );

    shopAdapter = new FakeAdapter('fakeshop', 'commerce');
    const registry = new ConnectorRegistry([shopAdapter]);
    registry.register(new FakeAdapter('fakedesk', 'bookings'));
    connectors = new ConnectorsService(registry);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    shopAdapter.test = () => Promise.resolve({ ok: true, detail: 'connected' });
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

  function createConnection(vendor: string, name: string) {
    return run(() =>
      connectors.createConnection({
        vendor,
        name,
        config: { host: `${name.toLowerCase().replace(/\s+/g, '-')}.example.com`, apiToken: 'tok_plaintext_secret' },
      }),
    );
  }

  describe('connections', () => {
    it('creates a connection with the domain derived from the vendor and secrets encrypted', async () => {
      const shop = await createConnection('fakeshop', 'Main store');
      const desk = await createConnection('fakedesk', 'Front desk');

      expect(shop.domain).toBe('commerce');
      expect(desk.domain).toBe('bookings');
      expect(JSON.stringify([shop, desk])).not.toMatch(/tok_plaintext_secret/);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db.select().from(schema.connectorConnections);
      for (const row of rows) {
        expect(JSON.stringify(row.config)).not.toMatch(/tok_plaintext_secret/);
      }
    });

    it('rejects a duplicate connection name before hitting the unique index', async () => {
      await createConnection('fakeshop', 'Main store');
      await expect(createConnection('fakeshop', 'Main store')).rejects.toThrow(
        /connectors_conflict/,
      );
    });

    it('rejects an unknown vendor', async () => {
      await expect(
        run(() => connectors.createConnection({ vendor: 'woocommerce', name: 'x', config: {} })),
      ).rejects.toThrow(/unknown vendor/);
    });

    it('rejects invalid config with per-field errors and a readable summary', async () => {
      const err = await run(() =>
        connectors.createConnection({
          vendor: 'fakeshop',
          name: 'Bad config',
          config: { host: '', apiToken: 'tok_plaintext_secret' },
        }),
      ).then(
        () => null,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        message: string;
        fieldErrors: Array<{ field: string; message: string }>;
      };
      expect(response.message).toMatch(/^connectors_invalid: config for fakeshop: host: /);
      expect(response.message).not.toMatch(/[[{]/);
      expect(response.fieldErrors).toHaveLength(1);
      expect(response.fieldErrors[0]!.field).toBe('host');
      expect(response.fieldErrors[0]!.message.length).toBeGreaterThan(0);
    });

    it('keeps the stored secret when config is updated without the token', async () => {
      const dto = await createConnection('fakeshop', 'Main store');
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const before = await db.select().from(schema.connectorConnections);
      const ctBefore = (before[0]!.config as { encryptedApiToken: string }).encryptedApiToken;

      const updated = await run(() =>
        connectors.updateConnection({
          connectionId: dto.id,
          config: { host: 'eu.example.com' },
        }),
      );

      expect(updated.settings.host).toBe('eu.example.com');
      const after = await db.select().from(schema.connectorConnections);
      expect((after[0]!.config as { encryptedApiToken: string }).encryptedApiToken).toBe(ctBefore);
    });

    it('decrypts the stored secret back to the plaintext inside adapter calls', async () => {
      const dto = await createConnection('fakeshop', 'Main store');
      let seen: string | null = null;
      shopAdapter.test = async (ctx) => {
        seen = await ctx.decryptSecret(ctx.config.encryptedApiToken as string);
        return { ok: true, detail: 'connected' };
      };

      await run(() => connectors.testConnection({ connectionId: dto.id }));
      expect(seen).toBe('tok_plaintext_secret');
    });

    it('records credential test failures and clears them on success', async () => {
      const dto = await createConnection('fakeshop', 'Main store');

      shopAdapter.test = () =>
        Promise.reject(new ConnectorVendorError('fakeshop responded 401'));
      const failed = await run(() => connectors.testConnection({ connectionId: dto.id }));
      expect(failed.ok).toBe(false);

      let listed = await run(() => connectors.listConnections());
      expect(listed[0]!.lastTestError).toMatch(/401/);

      shopAdapter.test = () => Promise.resolve({ ok: true, detail: 'connected to Main store' });
      const passed = await run(() => connectors.testConnection({ connectionId: dto.id }));
      expect(passed).toEqual({ ok: true, detail: 'connected to Main store' });

      listed = await run(() => connectors.listConnections());
      expect(listed[0]!.lastTestError).toBeNull();
    });
  });

  describe('resolveScope', () => {
    it('resolves each domain to its own single active connection without connectionId', async () => {
      await createConnection('fakeshop', 'Main store');
      await createConnection('fakedesk', 'Front desk');

      const commerce = await run(() => connectors.resolveScope('commerce'));
      const bookings = await run(() => connectors.resolveScope('bookings'));

      expect(commerce.connection.vendor).toBe('fakeshop');
      expect(bookings.connection.vendor).toBe('fakedesk');
    });

    it('rejects a connectionId that belongs to another domain', async () => {
      const desk = await createConnection('fakedesk', 'Front desk');

      await expect(run(() => connectors.resolveScope('commerce', desk.id))).rejects.toThrow(
        /is a bookings connection, not commerce/,
      );
    });

    it('rejects an explicit connectionId that is not active', async () => {
      const shop = await createConnection('fakeshop', 'Main store');
      await run(() => connectors.updateConnection({ connectionId: shop.id, active: false }));

      await expect(run(() => connectors.resolveScope('commerce', shop.id))).rejects.toThrow(
        /is not active/,
      );
    });

    it('requires connectionId only when the same domain has multiple active connections', async () => {
      await createConnection('fakeshop', 'Store A');
      await createConnection('fakeshop', 'Store B');
      await createConnection('fakedesk', 'Front desk');

      await expect(run(() => connectors.resolveScope('commerce'))).rejects.toThrow(
        /multiple active commerce connections/,
      );
      const bookings = await run(() => connectors.resolveScope('bookings'));
      expect(bookings.connection.name).toBe('Front desk');
    });

    it('rejects a domain with no active connection', async () => {
      await expect(run(() => connectors.resolveScope('commerce'))).rejects.toThrow(
        /no active commerce connection/,
      );
    });
  });

  describe('requireEndUserEmail', () => {
    it("returns the calling end-user's own email", async () => {
      const email = await run(() => connectors.requireEndUserEmail(), endUserActor);
      expect(email).toBe('jane@example.com');
    });

    it('rejects callers without an end-user identity', async () => {
      await expect(run(() => connectors.requireEndUserEmail())).rejects.toThrow(
        /end-user identity required/,
      );
    });

    it('rejects an end-user record without an email', async () => {
      const anonActor = new ActorIdentity(
        'end_user_agent',
        'tok_anon',
        orgId,
        ['bookings:read'],
        ['self_service'],
        noEmailEndUserId,
      );

      await expect(run(() => connectors.requireEndUserEmail(), anonActor)).rejects.toThrow(
        /no email identity/,
      );
    });
  });

  describe('vendorCall', () => {
    it('maps vendor failures to 502 and SSRF blocks to 400', async () => {
      await expect(
        run(() =>
          connectors.vendorCall(() => Promise.reject(new ConnectorVendorError('boom'))),
        ),
      ).rejects.toThrow(/connectors_vendor_error/);

      await expect(
        run(() =>
          connectors.vendorCall(() => Promise.reject(new SsrfBlockedError('10.0.0.1 blocked'))),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('RLS', () => {
    it('lets an end-user context read connections but not write them', async () => {
      const dto = await createConnection('fakeshop', 'Main store');

      const visible = await run(
        () => getCurrentContext().db.select().from(schema.connectorConnections),
        endUserActor,
      );
      expect(visible.map((r) => r.id)).toEqual([dto.id]);

      await expect(
        run(
          () =>
            getCurrentContext()
              .db.update(schema.connectorConnections)
              .set({ name: 'hijacked' })
              .where(sql`id = ${dto.id}`)
              .returning(),
          endUserActor,
        ),
      ).rejects.toThrow();

      await expect(
        run(
          () =>
            getCurrentContext()
              .db.insert(schema.connectorConnections)
              .values({ orgId, vendor: 'fakeshop', domain: 'commerce', name: 'rogue', config: {} })
              .returning(),
          endUserActor,
        ),
      ).rejects.toThrow();
    });

    it('hides connections from other orgs', async () => {
      await createConnection('fakeshop', 'Main store');
      const [otherOrg] = await db
        .insert(schema.orgs)
        .values({ name: 'Other Connectors Org' })
        .returning();
      const otherActor = new ActorIdentity('admin_agent', 'agt_other', otherOrg!.id, ['*'], ['admin']);

      const listed = await run(() => connectors.listConnections(), otherActor);
      expect(listed).toEqual([]);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${otherOrg!.id}`);
    });
  });
});
