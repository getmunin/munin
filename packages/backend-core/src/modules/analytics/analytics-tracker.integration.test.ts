import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix, signHmac } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { createApp } from '../../bootstrap-app.ts';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run analytics tracker tests.';

(skipReason ? describe.skip : describe)('Analytics tracker integration: public-key ingest', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Analytics IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'analytics-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  it('mint tracker → tracker.js served → pixel + beacon record rows; bot/invalid key dropped', async () => {
    const minted = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string; trackerKey: string; keyPrefix: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'getmunin.com landing' },
        }),
      );
    });
    expect(minted.trackerKey).toMatch(/^mn_track_[A-Za-z0-9_-]+$/);

    const beforePixel = await countTrackerEvents(db, orgId);
    const pixel = await fetch(
      `${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=pricing&t=page&v=visitor-1`,
    );
    expect(pixel.status).toBe(200);
    expect(pixel.headers.get('content-type')).toBe('image/gif');
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > beforePixel);

    const pixelBot = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=pricing`, {
      headers: { 'user-agent': 'Googlebot/2.1' },
    });
    expect(pixelBot.status).toBe(200);
    expect(await countTrackerEvents(db, orgId)).toBe(beforePixel + 1);

    const beforeBeacon = await countTrackerEvents(db, orgId);
    const beacon = await fetch(`${baseUrl}/v1/a/t`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        subjectType: 'page',
        subjectId: 'pricing',
        path: '/pricing',
        referrer: 'https://google.com',
        visitorId: 'visitor-2',
        dwellMs: 8000,
        readDepth: 60,
        utm: { source: 'reddit', medium: 'social', campaign: 'launch' },
        metadata: { variant: 'b' },
      }),
    });
    expect(beacon.status).toBe(204);
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > beforeBeacon);
    const beaconRow = await db
      .select()
      .from(schema.analyticsViewEvents)
      .where(sql`org_id = ${orgId} AND source = 'tracker' AND visitor_id = 'visitor-2'`)
      .limit(1);
    expect(beaconRow[0]?.dwellMs).toBe(8000);
    expect(beaconRow[0]?.readDepth).toBe(60);
    expect(beaconRow[0]?.utmSource).toBe('reddit');
    expect(beaconRow[0]?.subjectType).toBe('page');
    expect(beaconRow[0]?.metadata).toMatchObject({ variant: 'b' });
    expect(beaconRow[0]?.country).toBeNull();

    const beforeNullPayload = await countTrackerEvents(db, orgId);
    const nullPayload = await fetch(`${baseUrl}/v1/a/t`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        subjectType: 'page',
        subjectId: 'direct-nav',
        path: '/direct-nav',
        referrer: null,
        visitorId: null,
        locale: null,
        dwellMs: null,
        readDepth: null,
        utm: null,
        metadata: null,
      }),
    });
    expect(nullPayload.status).toBe(204);
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > beforeNullPayload);

    const engagement = await withClient(adminKey, async (c) =>
      parseToolResult<{
        views: number;
        visitors: number;
        avgDwellMs: number | null;
        avgReadDepth: number | null;
        lastViewAt: string | null;
      }>(
        await c.callTool({
          name: 'analytics_get_subject_engagement',
          arguments: { subjectType: 'page', subjectId: 'pricing', sinceDays: 1 },
        }),
      ),
    );
    expect(engagement.views).toBeGreaterThan(0);
    expect(engagement.avgDwellMs).toBe(8000);
    expect(engagement.avgReadDepth).toBe(60);
    expect(engagement.lastViewAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const badKey = 'mn_track_invalid_xxx';
    const beforeBad = await countTrackerEvents(db, orgId);
    const bad = await fetch(`${baseUrl}/v1/a/t/${badKey}.gif?s=pricing`);
    expect(bad.status).toBe(200);
    expect(await countTrackerEvents(db, orgId)).toBe(beforeBad);
  }, 30_000);

  it('viewId enrichment keeps one row per view and never overwrites attribution', async () => {
    const minted = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'dedup tracker' },
        }),
      ),
    );

    const subject = `/dedup-${minted.id}`;
    const viewId = `view-${minted.id}`;
    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: subject,
      path: `${subject}?utm_source=hn`,
      referrer: 'https://news.ycombinator.com/',
      visitorId: 'visitor-dedup',
      viewId,
      utm: { source: 'hn', medium: 'social', campaign: 'launch' },
      metadata: { variant: 'a' },
    });
    await waitFor(async () => (await countTrackerEvents(db, orgId, subject)) === 1);

    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: subject,
      referrer: null,
      visitorId: 'visitor-dedup',
      viewId,
      dwellMs: 12_000,
      readDepth: 75,
      utm: null,
      metadata: null,
    });
    await waitFor(async () => {
      const [row] = await viewRows(db, orgId, subject);
      return row?.dwellMs === 12_000;
    });

    expect(await countTrackerEvents(db, orgId, subject)).toBe(1);
    const [row] = await viewRows(db, orgId, subject);
    expect(row?.dwellMs).toBe(12_000);
    expect(row?.readDepth).toBe(75);
    expect(row?.referrer).toBe('https://news.ycombinator.com/');
    expect(row?.utmSource).toBe('hn');
    expect(row?.path).toBe(`${subject}?utm_source=hn`);
    expect(row?.metadata).toMatchObject({ variant: 'a' });

    const lowerDwell = await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: subject,
      visitorId: 'visitor-dedup',
      viewId,
      dwellMs: 10,
      readDepth: 25,
    });
    expect(lowerDwell).toBe(204);
    await new Promise((r) => setTimeout(r, 300));
    const [afterLower] = await viewRows(db, orgId, subject);
    expect(afterLower?.dwellMs).toBe(12_000);
    expect(afterLower?.readDepth).toBe(75);
  }, 30_000);

  it('an exit beacon that arrives first creates the row and the initial view fills attribution', async () => {
    const minted = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'out-of-order tracker' },
        }),
      ),
    );

    const subject = `/reordered-${minted.id}`;
    const viewId = `view-reordered-${minted.id}`;
    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: subject,
      referrer: null,
      visitorId: 'visitor-reordered',
      viewId,
      dwellMs: 4000,
    });
    await waitFor(async () => (await countTrackerEvents(db, orgId, subject)) === 1);

    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: subject,
      path: subject,
      referrer: 'https://google.com/',
      visitorId: 'visitor-reordered',
      viewId,
      utm: { source: 'newsletter' },
    });
    await waitFor(async () => {
      const [row] = await viewRows(db, orgId, subject);
      return row?.referrer === 'https://google.com/';
    });

    expect(await countTrackerEvents(db, orgId, subject)).toBe(1);
    const [row] = await viewRows(db, orgId, subject);
    expect(row?.dwellMs).toBe(4000);
    expect(row?.utmSource).toBe('newsletter');
    expect(row?.path).toBe(subject);
  }, 30_000);

  it('concurrent beacons with the same viewId collapse into one row', async () => {
    const minted = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'concurrent tracker' },
        }),
      ),
    );

    const subject = `/concurrent-${minted.id}`;
    const viewId = `view-concurrent-${minted.id}`;
    const bodies = [0, 1, 2, 3, 4].map((i) => ({
      key: minted.trackerKey,
      subjectId: subject,
      visitorId: 'visitor-concurrent',
      viewId,
      dwellMs: 1000 * (i + 1),
    }));
    const statuses = await Promise.all(bodies.map((body) => postBeacon(baseUrl, body)));
    expect(statuses.every((s) => s === 204)).toBe(true);

    await waitFor(async () => (await countTrackerEvents(db, orgId, subject)) === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(await countTrackerEvents(db, orgId, subject)).toBe(1);
    const [row] = await viewRows(db, orgId, subject);
    expect(row?.dwellMs).toBe(5000);
  }, 30_000);

  it('beacons without a viewId still insert one row each', async () => {
    const minted = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'legacy tracker' },
        }),
      ),
    );

    const subject = `/legacy-${minted.id}`;
    for (const dwellMs of [undefined, 9000]) {
      await postBeacon(baseUrl, {
        key: minted.trackerKey,
        subjectId: subject,
        visitorId: 'visitor-legacy',
        dwellMs,
      });
    }
    await waitFor(async () => (await countTrackerEvents(db, orgId, subject)) === 2);
    const rows = await viewRows(db, orgId, subject);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.clientViewId === null)).toBe(true);
  }, 30_000);

  it('folds locale prefixes and trailing slashes with no configuration, leaving path raw', async () => {
    const minted = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string; trackerKey: string; canonicalLocales: string[] }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'canonical tracker' },
        }),
      ),
    );
    expect(minted.canonicalLocales).toEqual([]);

    const marker = `canonical-${minted.id}`;
    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: `/en/${marker}/`,
      path: `/en/${marker}/?ref=1`,
      locale: 'en-US',
      visitorId: 'visitor-canonical-en',
    });
    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: `/nb/${marker}`,
      path: `/nb/${marker}`,
      locale: 'nb-NO',
      visitorId: 'visitor-canonical-nb',
    });
    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: `${marker}-click`,
      subjectType: 'funnel',
      locale: 'en-US',
      visitorId: 'visitor-canonical-nb',
    });
    await waitFor(async () => (await countTrackerEvents(db, orgId, `/${marker}`)) === 2);

    const rows = await viewRows(db, orgId, `/${marker}`);
    expect(rows.map((r) => r.path).sort()).toEqual([
      `/en/${marker}/?ref=1`,
      `/nb/${marker}`,
    ]);
    expect(await countTrackerEvents(db, orgId, `${marker}-click`)).toBe(1);

    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: `/enterprise/${marker}`,
      locale: 'en-US',
      visitorId: 'visitor-canonical-en',
    });
    await waitFor(
      async () => (await countTrackerEvents(db, orgId, `/enterprise/${marker}`)) === 1,
    );
  }, 30_000);

  it('honors canonicalLocales when the URL prefix disagrees with the lang tag', async () => {
    const minted = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'override tracker' },
        }),
      ),
    );
    const marker = `override-${minted.id}`;

    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: `/no/${marker}`,
      locale: 'nb-NO',
      visitorId: 'visitor-override-1',
    });
    await waitFor(async () => (await countTrackerEvents(db, orgId, `/no/${marker}`)) === 1);

    const updated = await withClient(adminKey, async (c) =>
      parseToolResult<{ canonicalLocales: string[] }>(
        await c.callTool({
          name: 'analytics_update_tracker',
          arguments: { trackerId: minted.id, canonicalLocales: ['NO '] },
        }),
      ),
    );
    expect(updated.canonicalLocales).toEqual(['no']);

    await postBeacon(baseUrl, {
      key: minted.trackerKey,
      subjectId: `/no/${marker}`,
      locale: 'nb-NO',
      visitorId: 'visitor-override-2',
    });
    await waitFor(async () => (await countTrackerEvents(db, orgId, `/${marker}`)) === 1);

    await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=/no/${marker}/&v=visitor-pixel`);
    await waitFor(async () => (await countTrackerEvents(db, orgId, `/${marker}`)) === 2);
  }, 30_000);

  it('POST /v1/a/s records search events and feeds zero-result searches', async () => {
    const { orgId: searchOrg, key: searchAdminKey } = await createSeedOrg(db, 'Search Org');
    try {
      const minted = await withClient(searchAdminKey, async (c) =>
        parseToolResult<{ id: string; trackerKey: string }>(
          await c.callTool({
            name: 'analytics_create_tracker',
            arguments: { name: 'search tracker' },
          }),
        ),
      );

      const res = await fetch(`${baseUrl}/v1/a/s`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          key: minted.trackerKey,
          query: 'refund policy',
          resultCount: 0,
          visitorId: 'visitor-search-1',
          locale: 'en',
        }),
      });
      expect(res.status).toBe(204);
      await waitFor(async () => (await countSearchEvents(db, searchOrg)) === 1);

      const [row] = await db
        .select()
        .from(schema.analyticsSearchEvents)
        .where(sql`org_id = ${searchOrg}`)
        .limit(1);
      expect(row?.subjectType).toBe('site');
      expect(row?.query).toBe('refund policy');
      expect(row?.resultCount).toBe(0);
      expect(row?.visitorId).toBe('visitor-search-1');

      const botted = await fetch(`${baseUrl}/v1/a/s`, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          'user-agent':
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
        body: JSON.stringify({
          key: minted.trackerKey,
          query: 'bot query',
          resultCount: 0,
        }),
      });
      expect(botted.status).toBe(204);
      const invalidKey = await fetch(`${baseUrl}/v1/a/s`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          key: 'mn_track_invalid_xxx',
          query: 'unauthorized',
          resultCount: 0,
        }),
      });
      expect(invalidKey.status).toBe(204);
      await new Promise((r) => setTimeout(r, 300));
      expect(await countSearchEvents(db, searchOrg)).toBe(1);

      const zero = await withClient(searchAdminKey, async (c) =>
        parseToolResult<Array<{ query: string; occurrences: number }>>(
          await c.callTool({
            name: 'analytics_list_zero_result_searches',
            arguments: { sinceDays: 1, limit: 10 },
          }),
        ),
      );
      expect(zero).toEqual([
        expect.objectContaining({ query: 'refund policy', occurrences: 1 }),
      ]);
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${searchOrg}`);
    }
  }, 30_000);

  it('identify backfills end_user_id onto the visitor\'s earlier anonymous events', async () => {
    const { orgId: backfillOrg, key: backfillAdminKey } = await createSeedOrg(
      db,
      'Backfill Org',
    );
    try {
      const minted = await withClient(backfillAdminKey, async (c) =>
        parseToolResult<{ id: string; trackerKey: string; identityVerificationSecret: string }>(
          await c.callTool({
            name: 'analytics_create_tracker',
            arguments: { name: 'backfill tracker' },
          }),
        ),
      );

      const visitorId = 'visitor-backfill-1';
      await postBeacon(baseUrl, {
        key: minted.trackerKey,
        subjectId: '/landing',
        path: '/landing',
        visitorId,
      });
      await fetch(`${baseUrl}/v1/a/s`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          key: minted.trackerKey,
          query: 'pricing',
          resultCount: 2,
          visitorId,
        }),
      });
      await waitFor(async () => (await countTrackerEvents(db, backfillOrg, '/landing')) === 1);
      await waitFor(async () => (await countSearchEvents(db, backfillOrg)) === 1);

      const stale = await db
        .select({ endUserId: schema.analyticsViewEvents.endUserId })
        .from(schema.analyticsViewEvents)
        .where(sql`org_id = ${backfillOrg} AND visitor_id = ${visitorId}`);
      expect(stale.every((r) => r.endUserId === null)).toBe(true);

      const externalId = 'customer:backfill';
      const userHash = signHmac(
        `${externalId}:${visitorId}`,
        minted.identityVerificationSecret,
      );
      const identifyRes = await fetch(`${baseUrl}/v1/a/identify`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ key: minted.trackerKey, visitorId, externalId, userHash }),
      });
      expect(identifyRes.status).toBe(204);

      await waitFor(async () => {
        const rows = await db
          .select({ endUserId: schema.analyticsViewEvents.endUserId })
          .from(schema.analyticsViewEvents)
          .where(sql`org_id = ${backfillOrg} AND visitor_id = ${visitorId}`);
        return rows.length > 0 && rows.every((r) => r.endUserId !== null);
      });
      const searchRows = await db
        .select({ endUserId: schema.analyticsSearchEvents.endUserId })
        .from(schema.analyticsSearchEvents)
        .where(sql`org_id = ${backfillOrg} AND visitor_id = ${visitorId}`);
      expect(searchRows.every((r) => r.endUserId !== null)).toBe(true);

      const engagement = await withClient(backfillAdminKey, async (c) =>
        parseToolResult<{ views: number }>(
          await c.callTool({
            name: 'analytics_get_subject_engagement',
            arguments: { subjectType: 'page', subjectId: '/landing', sinceDays: 1 },
          }),
        ),
      );
      expect(engagement.views).toBe(1);
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${backfillOrg}`);
    }
  }, 30_000);

  it('leaves events older than the backfill window anonymous', async () => {
    const { orgId: windowOrg, key: windowAdminKey } = await createSeedOrg(db, 'Window Org');
    try {
      const minted = await withClient(windowAdminKey, async (c) =>
        parseToolResult<{ trackerKey: string; identityVerificationSecret: string }>(
          await c.callTool({
            name: 'analytics_create_tracker',
            arguments: { name: 'window tracker' },
          }),
        ),
      );
      const visitorId = 'visitor-window-1';
      await db.insert(schema.analyticsViewEvents).values([
        {
          orgId: windowOrg,
          subjectType: 'page',
          subjectId: '/ancient',
          visitorId,
          source: 'tracker',
          createdAt: new Date(Date.now() - 40 * 86400000),
        },
        {
          orgId: windowOrg,
          subjectType: 'page',
          subjectId: '/recent',
          visitorId,
          source: 'tracker',
          createdAt: new Date(Date.now() - 86400000),
        },
      ]);

      const externalId = 'customer:window';
      const userHash = signHmac(
        `${externalId}:${visitorId}`,
        minted.identityVerificationSecret,
      );
      const res = await fetch(`${baseUrl}/v1/a/identify`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ key: minted.trackerKey, visitorId, externalId, userHash }),
      });
      expect(res.status).toBe(204);

      await waitFor(async () => {
        const [recent] = await db
          .select({ endUserId: schema.analyticsViewEvents.endUserId })
          .from(schema.analyticsViewEvents)
          .where(sql`org_id = ${windowOrg} AND subject_id = '/recent'`);
        return recent?.endUserId !== null;
      });
      const [ancient] = await db
        .select({ endUserId: schema.analyticsViewEvents.endUserId })
        .from(schema.analyticsViewEvents)
        .where(sql`org_id = ${windowOrg} AND subject_id = '/ancient'`);
      expect(ancient?.endUserId).toBeNull();
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${windowOrg}`);
    }
  }, 30_000);

  it('revoked tracker key stops recording', async () => {
    const minted = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'short-lived' },
        }),
      );
    });
    const subject = `revoke-${minted.id}`;
    const before = await countTrackerEvents(db, orgId, subject);
    await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=${subject}`);
    await waitFor(async () => (await countTrackerEvents(db, orgId, subject)) > before);

    await withClient(adminKey, async (c) => {
      const res = parseToolResult<{ revoked: boolean }>(
        await c.callTool({
          name: 'analytics_revoke_tracker',
          arguments: { trackerId: minted.id },
        }),
      );
      expect(res.revoked).toBe(true);
    });

    const afterRevoke = await countTrackerEvents(db, orgId, subject);
    await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=${subject}`);
    await new Promise((r) => setTimeout(r, 500));
    expect(await countTrackerEvents(db, orgId, subject)).toBe(afterRevoke);
  }, 30_000);

  it('origin allowlist gates pixel + beacon', async () => {
    const minted = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string; trackerKey: string; allowedOrigins: string[] }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: {
            name: 'gated tracker',
            allowedOrigins: ['https://customer.example'],
          },
        }),
      );
    });
    expect(minted.allowedOrigins).toEqual(['https://customer.example']);

    const subject = `allowlist-${minted.id}`;
    const allowedBefore = await countTrackerEvents(db, orgId, subject);
    const allowed = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=${subject}`, {
      headers: { origin: 'https://customer.example' },
    });
    expect(allowed.status).toBe(200);
    await waitFor(async () => (await countTrackerEvents(db, orgId, subject)) > allowedBefore);

    const beforeDenied = await countTrackerEvents(db, orgId, subject);
    const denied = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=${subject}`, {
      headers: { origin: 'https://attacker.example' },
    });
    expect(denied.status).toBe(200);

    const missing = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=${subject}`);
    expect(missing.status).toBe(200);

    const beaconDenied = await fetch(`${baseUrl}/v1/a/t`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ key: minted.trackerKey, subjectId: subject }),
    });
    expect(beaconDenied.status).toBe(204);

    await new Promise((r) => setTimeout(r, 500));
    expect(await countTrackerEvents(db, orgId, subject)).toBe(beforeDenied);

    await withClient(adminKey, async (c) => {
      const updated = parseToolResult<{ allowedOrigins: string[] }>(
        await c.callTool({
          name: 'analytics_update_tracker',
          arguments: { trackerId: minted.id, allowedOrigins: [] },
        }),
      );
      expect(updated.allowedOrigins).toEqual([]);
    });

    const beforeOpen = await countTrackerEvents(db, orgId, subject);
    const openAccess = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=${subject}`, {
      headers: { origin: 'https://anything.example' },
    });
    expect(openAccess.status).toBe(200);
    await waitFor(async () => (await countTrackerEvents(db, orgId, subject)) > beforeOpen);
  }, 30_000);

  it('traffic_by_source / referrer_hosts / views_over_time roll up seeded events', async () => {
    const [seedOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'Analytics Rollup Org' })
      .returning();
    const seedOrgId = seedOrg!.id;
    const rollupKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: seedOrgId,
      type: 'admin',
      name: 'analytics-rollup-admin',
      keyHash: hashSecret(rollupKey),
      keyPrefix: keyPrefix(rollupKey),
      scopes: ['*'],
    });

    const now = new Date();
    const daysAgo = (n: number): Date =>
      new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
    await db.insert(schema.analyticsViewEvents).values([
      {
        orgId: seedOrgId,
        subjectType: 'page',
        subjectId: '/pricing',
        path: '/pricing',
        referrer: 'https://news.ycombinator.com/item?id=1',
        visitorId: 'visitor-r1',
        utmSource: 'hn',
        utmMedium: 'social',
        utmCampaign: 'launch',
        source: 'tracker',
        createdAt: daysAgo(0),
      },
      {
        orgId: seedOrgId,
        subjectType: 'page',
        subjectId: '/pricing',
        path: '/pricing',
        referrer: 'https://news.ycombinator.com/item?id=2',
        visitorId: 'visitor-r2',
        utmSource: 'hn',
        utmMedium: 'social',
        utmCampaign: 'launch',
        source: 'tracker',
        createdAt: daysAgo(0),
      },
      {
        orgId: seedOrgId,
        subjectType: 'page',
        subjectId: '/about',
        path: '/about',
        referrer: 'https://www.reddit.com/r/programming',
        visitorId: 'visitor-r3',
        utmSource: 'reddit',
        utmMedium: 'social',
        utmCampaign: 'launch',
        source: 'tracker',
        createdAt: daysAgo(1),
      },
      {
        orgId: seedOrgId,
        subjectType: 'page',
        subjectId: '/about',
        path: '/about',
        referrer: null,
        visitorId: 'visitor-r4',
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        source: 'tracker',
        createdAt: daysAgo(2),
      },
      {
        orgId: seedOrgId,
        subjectType: 'page',
        subjectId: '/about',
        path: '/about',
        referrer: 'https://getmunin.com/blog/x',
        visitorId: 'visitor-r5',
        source: 'tracker',
        createdAt: daysAgo(3),
      },
    ]);

    try {
      const bySource = await withClient(rollupKey, async (c) =>
        parseToolResult<
          Array<{
            utmSource: string | null;
            utmMedium: string | null;
            utmCampaign: string | null;
            views: number;
            visitors: number;
          }>
        >(
          await c.callTool({
            name: 'analytics_get_traffic_by_source',
            arguments: { sinceDays: 7 },
          }),
        ),
      );
      const hn = bySource.find((r) => r.utmSource === 'hn');
      const reddit = bySource.find((r) => r.utmSource === 'reddit');
      const direct = bySource.find((r) => r.utmSource === null);
      expect(hn?.views).toBe(2);
      expect(hn?.visitors).toBe(2);
      expect(reddit?.views).toBe(1);
      expect(direct?.views).toBe(2);

      const hosts = await withClient(rollupKey, async (c) =>
        parseToolResult<Array<{ host: string | null; views: number; visitors: number }>>(
          await c.callTool({
            name: 'analytics_list_referrer_hosts',
            arguments: { excludeHost: 'getmunin.com', sinceDays: 7, limit: 10 },
          }),
        ),
      );
      const hosts2 = Object.fromEntries(hosts.map((r) => [r.host ?? 'null', r]));
      expect(hosts2['news.ycombinator.com']?.views).toBe(2);
      expect(hosts2['www.reddit.com']?.views).toBe(1);
      expect(hosts2['null']?.views).toBe(1);
      expect(hosts2['getmunin.com']).toBeUndefined();

      const series = await withClient(rollupKey, async (c) =>
        parseToolResult<Array<{ day: string; views: number; visitors: number }>>(
          await c.callTool({
            name: 'analytics_get_views_over_time',
            arguments: { sinceDays: 5 },
          }),
        ),
      );
      expect(series).toHaveLength(5);
      expect(series.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day))).toBe(true);
      const totalViews = series.reduce((s, r) => s + r.views, 0);
      expect(totalViews).toBe(5);
      expect(series[series.length - 1]?.views).toBe(2);
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${seedOrgId}`);
    }
  }, 30_000);

  it('identify links visitor to an end-user; subsequent beacons stamp end_user_id; tampered hash rejected', async () => {
    const minted = await withClient(adminKey, async (c) => {
      return parseToolResult<{
        id: string;
        trackerKey: string;
        identityVerificationSecret: string;
      }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'identify tracker' },
        }),
      );
    });
    expect(minted.identityVerificationSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const visitorId = 'visitor-identify-1';
    const externalId = 'customer:42';
    const userHash = signHmac(`${externalId}:${visitorId}`, minted.identityVerificationSecret);

    const identifyRes = await fetch(`${baseUrl}/v1/a/identify`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        visitorId,
        externalId,
        userHash,
      }),
    });
    expect(identifyRes.status).toBe(204);

    await waitFor(async () => {
      const rows = await db
        .select({ id: schema.endUsers.id })
        .from(schema.endUsers)
        .where(sql`org_id = ${orgId} AND external_id = ${externalId}`)
        .limit(1);
      return rows.length > 0;
    });
    const endUserRows = await db
      .select({ id: schema.endUsers.id })
      .from(schema.endUsers)
      .where(sql`org_id = ${orgId} AND external_id = ${externalId}`)
      .limit(1);
    const endUserId = endUserRows[0]!.id;
    const bridgeRows = await db
      .select({ endUserId: schema.analyticsVisitorIdentities.endUserId })
      .from(schema.analyticsVisitorIdentities)
      .where(sql`org_id = ${orgId} AND visitor_id = ${visitorId}`)
      .limit(1);
    expect(bridgeRows[0]?.endUserId).toBe(endUserId);

    const before = await countTrackerEvents(db, orgId);
    const beacon = await fetch(`${baseUrl}/v1/a/t`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        subjectType: 'page',
        subjectId: 'docs/getting-started',
        path: '/docs',
        visitorId,
      }),
    });
    expect(beacon.status).toBe(204);
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > before);
    const eventRow = await db
      .select()
      .from(schema.analyticsViewEvents)
      .where(
        sql`org_id = ${orgId} AND source = 'tracker' AND visitor_id = ${visitorId} AND subject_id = 'docs/getting-started'`,
      )
      .limit(1);
    expect(eventRow[0]?.endUserId).toBe(endUserId);

    const tampered = await fetch(`${baseUrl}/v1/a/identify`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        visitorId: 'visitor-tampered',
        externalId: 'customer:99',
        userHash: '0'.repeat(64),
      }),
    });
    expect(tampered.status).toBe(204);
    await new Promise((r) => setTimeout(r, 100));
    const tamperedBridge = await db
      .select()
      .from(schema.analyticsVisitorIdentities)
      .where(sql`org_id = ${orgId} AND visitor_id = 'visitor-tampered'`)
      .limit(1);
    expect(tamperedBridge.length).toBe(0);

    const replayed = await fetch(`${baseUrl}/v1/a/identify`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        visitorId: 'visitor-replayed',
        externalId,
        userHash,
      }),
    });
    expect(replayed.status).toBe(204);
    await new Promise((r) => setTimeout(r, 100));
    const replayedBridge = await db
      .select()
      .from(schema.analyticsVisitorIdentities)
      .where(sql`org_id = ${orgId} AND visitor_id = 'visitor-replayed'`)
      .limit(1);
    expect(replayedBridge.length).toBe(0);

    const journey = await withClient(adminKey, async (c) =>
      parseToolResult<
        Array<{
          kind: 'view' | 'search';
          subjectType: string | null;
          subjectId: string | null;
        }>
      >(
        await c.callTool({
          name: 'analytics_get_contact_journey',
          arguments: { endUserId, sinceDays: 7 },
        }),
      ),
    );
    expect(journey.some((e) => e.kind === 'view' && e.subjectId === 'docs/getting-started')).toBe(
      true,
    );
  }, 30_000);

  it('requireVerifiedIdentity drops unidentified beacons; verified beacons persist', async () => {
    const minted = await withClient(adminKey, async (c) => {
      return parseToolResult<{
        id: string;
        trackerKey: string;
        identityVerificationSecret: string;
      }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'require-verified tracker', requireVerifiedIdentity: true },
        }),
      );
    });

    const anonBefore = await countTrackerEvents(db, orgId);
    const anonRes = await fetch(`${baseUrl}/v1/a/t`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        subjectType: 'page',
        subjectId: 'gated/page',
        visitorId: 'visitor-anon-gated',
      }),
    });
    expect(anonRes.status).toBe(204);
    await new Promise((r) => setTimeout(r, 200));
    expect(await countTrackerEvents(db, orgId)).toBe(anonBefore);

    const visitorId = 'visitor-verified-gated';
    const externalId = 'user_gated_1';
    const userHash = signHmac(`${externalId}:${visitorId}`, minted.identityVerificationSecret);
    const identifyRes = await fetch(`${baseUrl}/v1/a/identify`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ key: minted.trackerKey, visitorId, externalId, userHash }),
    });
    expect(identifyRes.status).toBe(204);
    await waitFor(async () => {
      const rows = await db
        .select({ id: schema.analyticsVisitorIdentities.id })
        .from(schema.analyticsVisitorIdentities)
        .where(
          sql`org_id = ${orgId} AND visitor_id = ${visitorId}`,
        )
        .limit(1);
      return rows.length > 0;
    });

    const verifiedBefore = await countTrackerEvents(db, orgId);
    const verifiedRes = await fetch(`${baseUrl}/v1/a/t`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        key: minted.trackerKey,
        subjectType: 'page',
        subjectId: 'gated/verified',
        visitorId,
      }),
    });
    expect(verifiedRes.status).toBe(204);
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > verifiedBefore);
  }, 30_000);

  it('MUNIN_TRACKER_REQUIRE_ALLOWLIST=1 fail-closes empty allowlists', async () => {
    const minted = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'no-allowlist' },
        }),
      );
    });

    process.env.MUNIN_TRACKER_REQUIRE_ALLOWLIST = '1';
    try {
      const before = await countTrackerEvents(db, orgId);
      const res = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=home`, {
        headers: { origin: 'https://anything.example' },
      });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
      expect(await countTrackerEvents(db, orgId)).toBe(before);
    } finally {
      delete process.env.MUNIN_TRACKER_REQUIRE_ALLOWLIST;
    }
  }, 30_000);

  it('analytics_get_funnel counts ordered steps and drop-off', async () => {
    const { orgId: fOrg, key: fKey } = await createSeedOrg(db, 'Funnel Org A');
    const now = new Date();
    const sec = (s: number): Date => new Date(now.getTime() - s * 1000);
    const ev = (visitorId: string, subjectId: string, createdAt: Date) => ({
      orgId: fOrg,
      subjectType: 'page',
      subjectId,
      path: subjectId,
      visitorId,
      source: 'tracker' as const,
      createdAt,
    });
    await db.insert(schema.analyticsViewEvents).values([
      ev('fa-v1', '/pricing', sec(300)),
      ev('fa-v1', '/signup', sec(200)),
      ev('fa-v1', '/welcome/1', sec(100)),
      ev('fa-v2', '/pricing', sec(300)),
      ev('fa-v2', '/signup', sec(200)),
      ev('fa-v3', '/pricing', sec(300)),
      ev('fa-v4', '/signup', sec(300)),
      ev('fa-v4', '/pricing', sec(200)),
      ev('fa-v5', '/pricing', sec(300)),
      ev('fa-v5', '/about', sec(250)),
    ]);
    try {
      const funnel = await withClient(fKey, async (c) =>
        parseToolResult<FunnelResult>(
          await c.callTool({
            name: 'analytics_get_funnel',
            arguments: {
              steps: [
                { subjectType: 'page', subjectId: '/pricing' },
                { subjectType: 'page', subjectId: '/signup' },
                { pathLike: '/welcome/%' },
              ],
              sinceDays: 1,
            },
          }),
        ),
      );
      expect(funnel.steps.map((s) => s.actors)).toEqual([5, 2, 1]);
      expect(funnel.steps[0]!.conversionFromPrev).toBeNull();
      expect(funnel.steps[1]!.conversionFromPrev).toBeCloseTo(0.4);
      expect(funnel.steps[1]!.dropFromPrev).toBeCloseTo(0.6);
      expect(funnel.steps[2]!.conversionFromPrev).toBeCloseTo(0.5);
      expect(funnel.overallConversion).toBeCloseTo(0.2);
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${fOrg}`);
    }
  }, 30_000);

  it('analytics_get_funnel honors stepWindowHours', async () => {
    const { orgId, key } = await createSeedOrg(db, 'Funnel Org Window');
    const now = new Date();
    const hrs = (h: number): Date => new Date(now.getTime() - h * 3600 * 1000);
    const ev = (visitorId: string, subjectId: string, createdAt: Date) => ({
      orgId,
      subjectType: 'page',
      subjectId,
      path: subjectId,
      visitorId,
      source: 'tracker' as const,
      createdAt,
    });
    await db.insert(schema.analyticsViewEvents).values([
      ev('fw-in', '/pricing', hrs(3)),
      ev('fw-in', '/signup', hrs(2)),
      ev('fw-out', '/pricing', hrs(5)),
      ev('fw-out', '/signup', hrs(1)),
    ]);
    const steps = [
      { subjectType: 'page', subjectId: '/pricing' },
      { subjectType: 'page', subjectId: '/signup' },
    ];
    try {
      const noWindow = await withClient(key, async (c) =>
        parseToolResult<FunnelResult>(
          await c.callTool({
            name: 'analytics_get_funnel',
            arguments: { steps, sinceDays: 1 },
          }),
        ),
      );
      expect(noWindow.steps.map((s) => s.actors)).toEqual([2, 2]);

      const windowed = await withClient(key, async (c) =>
        parseToolResult<FunnelResult>(
          await c.callTool({
            name: 'analytics_get_funnel',
            arguments: { steps, sinceDays: 1, stepWindowHours: 2 },
          }),
        ),
      );
      expect(windowed.steps.map((s) => s.actors)).toEqual([2, 1]);
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  }, 30_000);

  it('funnel merges a visitor\'s linked identities; journey includes pre-identify events', async () => {
    const { orgId, key } = await createSeedOrg(db, 'Funnel Org Identity');
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'cust-merge-1' })
      .returning();
    const euId = eu!.id;
    const now = new Date();
    const sec = (s: number): Date => new Date(now.getTime() - s * 1000);
    await db.insert(schema.analyticsViewEvents).values([
      {
        orgId,
        subjectType: 'page',
        subjectId: '/pricing',
        path: '/pricing',
        visitorId: 'fi-vA',
        source: 'tracker',
        createdAt: sec(300),
      },
      {
        orgId,
        subjectType: 'page',
        subjectId: '/signup',
        path: '/signup',
        visitorId: 'fi-vB',
        endUserId: euId,
        source: 'tracker',
        createdAt: sec(200),
      },
    ]);
    await db.insert(schema.analyticsVisitorIdentities).values([
      { orgId, visitorId: 'fi-vA', endUserId: euId },
      { orgId, visitorId: 'fi-vB', endUserId: euId },
    ]);
    try {
      const funnel = await withClient(key, async (c) =>
        parseToolResult<FunnelResult>(
          await c.callTool({
            name: 'analytics_get_funnel',
            arguments: {
              steps: [
                { subjectType: 'page', subjectId: '/pricing' },
                { subjectType: 'page', subjectId: '/signup' },
              ],
              sinceDays: 1,
            },
          }),
        ),
      );
      expect(funnel.steps.map((s) => s.actors)).toEqual([1, 1]);

      const journey = await withClient(key, async (c) =>
        parseToolResult<Array<{ kind: string; subjectId: string | null }>>(
          await c.callTool({
            name: 'analytics_get_contact_journey',
            arguments: { endUserId: euId, sinceDays: 1 },
          }),
        ),
      );
      expect(journey.some((e) => e.subjectId === '/pricing')).toBe(true);
      expect(journey.some((e) => e.subjectId === '/signup')).toBe(true);
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  }, 30_000);
});

interface FunnelResult {
  sinceDays: number;
  steps: Array<{
    index: number;
    label: string;
    actors: number;
    conversionFromPrev: number | null;
    dropFromPrev: number | null;
    conversionFromStart: number;
  }>;
  overallConversion: number;
}

async function createSeedOrg(
  db: ReturnType<typeof createDb>,
  name: string,
): Promise<{ orgId: string; key: string }> {
  const [org] = await db.insert(schema.orgs).values({ name }).returning();
  const key = buildApiKey('admin');
  await db.insert(schema.apiKeys).values({
    orgId: org!.id,
    type: 'admin',
    name: `${name} admin`,
    keyHash: hashSecret(key),
    keyPrefix: keyPrefix(key),
    scopes: ['*'],
  });
  return { orgId: org!.id, key };
}

async function postBeacon(baseUrl: string, body: Record<string, unknown>): Promise<number> {
  const res = await fetch(`${baseUrl}/v1/a/t`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ subjectType: 'page', ...body }),
  });
  return res.status;
}

async function viewRows(
  db: ReturnType<typeof createDb>,
  orgId: string,
  subjectId: string,
): Promise<Array<typeof schema.analyticsViewEvents.$inferSelect>> {
  return db
    .select()
    .from(schema.analyticsViewEvents)
    .where(sql`org_id = ${orgId} AND subject_id = ${subjectId}`)
    .orderBy(schema.analyticsViewEvents.createdAt);
}

async function countSearchEvents(
  db: ReturnType<typeof createDb>,
  orgId: string,
): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.analyticsSearchEvents)
    .where(sql`org_id = ${orgId}`);
  return r[0]?.n ?? 0;
}

async function countTrackerEvents(
  db: ReturnType<typeof createDb>,
  orgId: string,
  subjectId?: string,
): Promise<number> {
  const where = subjectId
    ? sql`org_id = ${orgId} AND source = 'tracker' AND subject_id = ${subjectId}`
    : sql`org_id = ${orgId} AND source = 'tracker'`;
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.analyticsViewEvents)
    .where(where);
  return r[0]?.n ?? 0;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: condition not met before timeout');
}

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
