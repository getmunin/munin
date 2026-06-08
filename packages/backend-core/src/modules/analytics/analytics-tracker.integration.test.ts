import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
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
          name: 'analytics_subject_engagement',
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

  it('revoked tracker key stops recording', async () => {
    const minted = await withClient(adminKey, async (c) => {
      return parseToolResult<{ id: string; trackerKey: string }>(
        await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'short-lived' },
        }),
      );
    });
    const before = await countTrackerEvents(db, orgId);
    await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=home`);
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > before);

    await withClient(adminKey, async (c) => {
      const res = parseToolResult<{ revoked: boolean }>(
        await c.callTool({
          name: 'analytics_revoke_tracker',
          arguments: { trackerId: minted.id },
        }),
      );
      expect(res.revoked).toBe(true);
    });

    const afterRevoke = await countTrackerEvents(db, orgId);
    await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=home`);
    await new Promise((r) => setTimeout(r, 200));
    expect(await countTrackerEvents(db, orgId)).toBe(afterRevoke);
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

    const allowedBefore = await countTrackerEvents(db, orgId);
    const allowed = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=home`, {
      headers: { origin: 'https://customer.example' },
    });
    expect(allowed.status).toBe(200);
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > allowedBefore);

    const beforeDenied = await countTrackerEvents(db, orgId);
    const denied = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=home`, {
      headers: { origin: 'https://attacker.example' },
    });
    expect(denied.status).toBe(200);

    const missing = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=home`);
    expect(missing.status).toBe(200);

    const beaconDenied = await fetch(`${baseUrl}/v1/a/t`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ key: minted.trackerKey, subjectId: 'home' }),
    });
    expect(beaconDenied.status).toBe(204);

    await new Promise((r) => setTimeout(r, 200));
    expect(await countTrackerEvents(db, orgId)).toBe(beforeDenied);

    await withClient(adminKey, async (c) => {
      const updated = parseToolResult<{ allowedOrigins: string[] }>(
        await c.callTool({
          name: 'analytics_update_tracker',
          arguments: { trackerId: minted.id, allowedOrigins: [] },
        }),
      );
      expect(updated.allowedOrigins).toEqual([]);
    });

    const beforeOpen = await countTrackerEvents(db, orgId);
    const openAccess = await fetch(`${baseUrl}/v1/a/t/${minted.trackerKey}.gif?s=home`, {
      headers: { origin: 'https://anything.example' },
    });
    expect(openAccess.status).toBe(200);
    await waitFor(async () => (await countTrackerEvents(db, orgId)) > beforeOpen);
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
            name: 'analytics_traffic_by_source',
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
            name: 'analytics_referrer_hosts',
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
            name: 'analytics_views_over_time',
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
});

async function countTrackerEvents(
  db: ReturnType<typeof createDb>,
  orgId: string,
): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.analyticsViewEvents)
    .where(sql`org_id = ${orgId} AND source = 'tracker'`);
  return r[0]?.n ?? 0;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
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
