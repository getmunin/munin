import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectorsService } from '../connectors/connectors.service.ts';
import { ConnectorRegistry } from '../connectors/connector.ts';
import type { ConnectorFetch } from '../connectors/http.ts';
import { BingAdapter } from './bing.adapter.ts';
import { SeoService } from './seo.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run seo service tests.';

interface StubCall {
  url: string;
  body: Record<string, unknown> | null;
}

(skipReason ? describe.skip : describe)('SeoService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let connectors: ConnectorsService;
  let seo: SeoService;
  let orgId: string;
  let adminActor: ActorIdentity;

  const calls: StubCall[] = [];
  let respond: (call: StubCall) => { status?: number; body: unknown } = () => ({ body: { d: [] } });

  const stubFetch: ConnectorFetch = (url, init) => {
    const call = {
      url,
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };

  const site = (url: string, verified = true) => ({ Url: url, IsVerified: verified });

  function respondWith(sites: unknown[], rest: (call: StubCall) => { status?: number; body: unknown }) {
    respond = (call) =>
      call.url.includes('GetUserSites') ? { body: { d: sites } } : rest(call);
  }

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Seo Service Test Org' }).returning();
    orgId = org!.id;
    adminActor = new ActorIdentity('admin_agent', 'agt_seo_test', orgId, ['*'], ['admin']);

    connectors = new ConnectorsService(new ConnectorRegistry([new BingAdapter(stubFetch)]));
    seo = new SeoService(connectors);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    calls.length = 0;
    respond = () => ({ body: { d: [] } });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM connector_connections WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: adminActor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  function createBingConnection() {
    return run(() =>
      connectors.createConnection({
        vendor: 'bing',
        name: 'Bing Webmaster',
        config: { apiKey: 'bing_api_key_plaintext' },
      }),
    );
  }

  it('stores the api key encrypted and never returns it in the connection config', async () => {
    const created = await createBingConnection();

    expect(created.settings).toEqual({});
    expect(created.credentialState).toBe('active');
    const [row] = await db.execute<{ config: Record<string, unknown> }>(
      sql`SELECT config FROM connector_connections WHERE id = ${created.id}`,
    );
    expect(JSON.stringify(row)).not.toContain('bing_api_key_plaintext');
  });

  it('resolves the property implicitly when the account has exactly one verified site', async () => {
    await createBingConnection();
    respondWith([site('https://example.com')], () => ({
      body: { d: [{ Query: 'munin', Impressions: 10, Clicks: 1 }] },
    }));

    const result = await run(() => seo.listQueries({ limit: 10 }));

    expect(result.siteUrl).toBe('https://example.com');
    expect(result.queries[0]!.query).toBe('munin');
  });

  it('demands siteUrl when the account holds several verified properties, and names them', async () => {
    await createBingConnection();
    respondWith([site('https://example.com'), site('https://shop.example.com')], () => ({
      body: { d: [] },
    }));

    const err = await run(() => seo.listQueries({ limit: 10 })).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('https://shop.example.com');
  });

  it('rejects a connection whose key has no verified properties', async () => {
    await createBingConnection();
    respondWith([site('https://example.com', false)], () => ({ body: { d: [] } }));

    await expect(run(() => seo.listQueries({ limit: 10 }))).rejects.toThrow(BadRequestException);
  });

  it('skips the property lookup entirely when siteUrl is supplied', async () => {
    await createBingConnection();
    respond = () => ({ body: { d: [] } });

    await run(() => seo.listQueries({ siteUrl: 'https://example.com', limit: 10 }));

    expect(calls.some((c) => c.url.includes('GetUserSites'))).toBe(false);
  });

  it('rejects an inverted date window before calling the vendor', async () => {
    await createBingConnection();

    await expect(
      run(() =>
        seo.listQueries({
          siteUrl: 'https://example.com',
          from: '2026-05-01',
          to: '2026-04-01',
          limit: 10,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('translates a missing index record into not-found rather than an empty result', async () => {
    await createBingConnection();
    respondWith([site('https://example.com')], () => ({ body: { d: null } }));

    await expect(
      run(() => seo.inspectUrl({ url: 'https://example.com/missing' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to submit urls that are not under the resolved property', async () => {
    await createBingConnection();
    respondWith([site('https://example.com')], () => ({ body: { d: null } }));

    const err = await run(() =>
      seo.submitUrls({ urls: ['https://example.com/ok', 'https://evil.test/nope'] }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('https://evil.test/nope');
    expect(calls.some((c) => c.url.includes('SubmitUrlBatch'))).toBe(false);
  });

  it('surfaces an over-quota batch as a client error, not a vendor gateway error', async () => {
    await createBingConnection();
    respondWith([site('https://example.com')], () => ({
      body: { d: { DailyQuota: 1, MonthlyQuota: 50 } },
    }));

    const err = await run(() =>
      seo.submitUrls({ urls: ['https://example.com/a', 'https://example.com/b'] }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('seo_invalid');
  });

  it('surfaces a throttled vendor as a gateway error', async () => {
    await createBingConnection();
    respondWith([site('https://example.com')], () => ({
      status: 400,
      body: { ErrorCode: 4, Message: 'Too many requests' },
    }));

    await expect(run(() => seo.listQueries({ limit: 10 }))).rejects.toThrow(BadGatewayException);
  });

  it('reports the submitted count and remaining quota on success', async () => {
    await createBingConnection();
    respondWith([site('https://example.com')], (call) =>
      call.url.includes('GetUrlSubmissionQuota')
        ? { body: { d: { DailyQuota: 10, MonthlyQuota: 100 } } }
        : { body: { d: null } },
    );

    const result = await run(() => seo.submitUrls({ urls: ['https://example.com/a'] }));

    expect(result).toMatchObject({
      siteUrl: 'https://example.com',
      submitted: 1,
      dailyQuotaRemaining: 9,
      monthlyQuotaRemaining: 99,
    });
  });

  it('refuses seo lookups when the org has no seo connection at all', async () => {
    await expect(run(() => seo.listProperties({}))).rejects.toThrow(BadRequestException);
  });
});
