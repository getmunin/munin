import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../bootstrap-app.ts';
import { AppModule } from '../../app.module.ts';
import { CmsScheduleWorker } from './cms.schedule.worker.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CMS integration tests.';

(skipReason ? describe.skip : describe)('CMS integration: admin authoring + public delivery', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let endUserToken: string;
  let storageDir: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    storageDir = await mkdtemp(join(tmpdir(), 'munin-cms-test-'));
    process.env.MUNIN_STORAGE_LOCAL_PATH = storageDir;
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'CMS IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'cms-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-1', name: 'Alice' })
      .returning();
    endUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['cms:read'],
      audiences: ['self_service'],
      endUserId: eu!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
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
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
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

  it('admin creates locale + collection → publish entry → fetched anonymously over delivery API', async () => {
    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'cms_create_locale',
        arguments: { code: 'en', name: 'English', isDefault: true },
      });
      await c.callTool({
        name: 'cms_create_collection',
        arguments: {
          name: 'Pages',
          slug: 'pages',
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'slug', type: 'text', required: true },
            { name: 'body', type: 'markdown' },
            { name: 'hero_image', type: 'asset' },
            { name: 'published_at', type: 'datetime' },
          ],
        },
      });

      const collections = parseToolResult<Array<{ id: string; slug: string; fields: unknown[] }>>(
        await c.callTool({ name: 'cms_list_collections', arguments: {} }),
      );
      expect(collections.find((c) => c.slug === 'pages')).toBeTruthy();

      // Create + publish an entry.
      const entry = parseToolResult<{ id: string; slug: string; version: number; status: string }>(
        await c.callTool({
          name: 'cms_create_entry',
          arguments: {
            collection: 'pages',
            slug: 'hello-world',
            data: { title: 'Hello, world', slug: 'hello-world', body: 'Welcome to Munin.' },
            status: 'published',
          },
        }),
      );
      expect(entry.status).toBe('published');
    });

    // Fetch anonymously via the public delivery API. waitFor absorbs the
    // commit-visibility race between the MCP request transaction and the
    // controller's separate service-role connection.
    const single = await fetchUntil(
      `${baseUrl}/v1/cms/${orgId}/pages/hello-world`,
      (r) => r.status === 200,
    );
    expect(single.status).toBe(200);
    expect(single.headers.get('etag')).toBeTruthy();
    const singleJson = (await single.json()) as { slug: string; data: Record<string, unknown> };
    expect(singleJson.slug).toBe('hello-world');
    expect(singleJson.data.title).toBe('Hello, world');

    // ETag round-trip.
    const cached = await fetch(`${baseUrl}/v1/cms/${orgId}/pages/hello-world`, {
      headers: { 'if-none-match': single.headers.get('etag')! },
    });
    expect(cached.status).toBe(304);

    // List works.
    const list = await fetch(`${baseUrl}/v1/cms/${orgId}/pages`);
    expect(list.status).toBe(200);
    const listJson = (await list.json()) as { items: Array<{ slug: string }> };
    expect(listJson.items.find((i) => i.slug === 'hello-world')).toBeTruthy();
  }, 30_000);

  it('drafts are NOT visible on the delivery API; cms_search admin sees them; public search hides them', async () => {
    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'pages',
          slug: 'draft-only',
          data: { title: 'Secret draft', slug: 'draft-only', body: 'Draft body.' },
          status: 'draft',
        },
      });

      // Admin search includes drafts.
      const adminHits = parseToolResult<Array<{ slug: string }>>(
        await c.callTool({
          name: 'cms_search',
          arguments: { query: 'secret', collection: 'pages' },
        }),
      );
      expect(adminHits.find((h) => h.slug === 'draft-only')).toBeTruthy();
    });

    // Public search hides drafts.
    const search = await fetch(
      `${baseUrl}/v1/cms/${orgId}/search?q=${encodeURIComponent('secret')}&collection=pages`,
    );
    expect(search.status).toBe(200);
    const hits = (await search.json()) as Array<{ slug: string }>;
    expect(hits.find((h) => h.slug === 'draft-only')).toBeFalsy();

    // GET on the draft entry returns 404 publicly.
    const fetched = await fetch(`${baseUrl}/v1/cms/${orgId}/pages/draft-only`);
    expect(fetched.status).toBe(404);
  }, 30_000);

  it('admin drafts route is not shadowed by the public delivery wildcard', async () => {
    // `GET /v1/cms/drafts/:id` and the public `GET /v1/cms/:orgId/:collectionSlug`
    // are both 4-segment routes; `/v1/cms/drafts/<id>` matches both. If the public
    // controller is registered first it wins (first-match-wins) and 404s with
    // `cms_not_found: org drafts`, never reaching the auth-guarded drafts route.
    let draftId = '';
    await withClient(adminKey, async (c) => {
      const created = parseToolResult<{ id: string }>(
        await c.callTool({
          name: 'cms_create_entry',
          arguments: {
            collection: 'pages',
            slug: 'draft-for-review',
            data: { title: 'Pending review', slug: 'draft-for-review', body: 'Body.' },
            status: 'draft',
          },
        }),
      );
      draftId = created.id;
    });

    // Unauthenticated: must reach the guarded drafts controller (401), NOT the
    // anonymous public wildcard (which would 404 on org "drafts").
    const anon = await fetch(`${baseUrl}/v1/cms/drafts/${draftId}`);
    expect(anon.status).toBe(401);

    // Authenticated admin: the draft is served for review.
    const authed = await fetch(`${baseUrl}/v1/cms/drafts/${draftId}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(authed.status).toBe(200);
    const body = (await authed.json()) as { id: string; status: string };
    expect(body.id).toBe(draftId);
    expect(body.status).toBe('draft');
  }, 30_000);

  it('schedule worker promotes due scheduled entries', async () => {
    let entryId = '';
    let entryVersion = 0;
    await withClient(adminKey, async (c) => {
      const created = parseToolResult<{ id: string; version: number }>(
        await c.callTool({
          name: 'cms_create_entry',
          arguments: {
            collection: 'pages',
            slug: 'scheduled-page',
            data: { title: 'Scheduled', slug: 'scheduled-page', body: 'Body.' },
          },
        }),
      );
      entryId = created.id;
      const scheduledAt = new Date(Date.now() + 1000).toISOString();
      const scheduled = parseToolResult<{ status: string; version: number }>(
        await c.callTool({
          name: 'cms_schedule_publish',
          arguments: { id: entryId, ifVersion: created.version, scheduledAt },
        }),
      );
      expect(scheduled.status).toBe('scheduled');
      entryVersion = scheduled.version;
    });

    // Push the scheduled time into the past (avoids waiting), then run the worker.
    await db
      .update(schema.cmsEntries)
      .set({ scheduledAt: new Date(Date.now() - 1000) })
      .where(sql`id = ${entryId}`);
    const worker = app.get(CmsScheduleWorker);
    const result = await worker.tick();
    expect(result.promoted).toBe(1);

    const fetched = await fetch(`${baseUrl}/v1/cms/${orgId}/pages/scheduled-page`);
    expect(fetched.status).toBe(200);
    void entryVersion;
  }, 30_000);

  it('delivery: a locale-specific draft is 404; published siblings in another locale are not silently substituted', async () => {
    await withClient(adminKey, async (c) => {
      // Add a second locale and create same-slug entries: en=published, es=draft.
      await c.callTool({
        name: 'cms_create_locale',
        arguments: { code: 'es', name: 'Spanish' },
      });
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'pages',
          slug: 'localized',
          locale: 'en',
          data: { title: 'EN', slug: 'localized', body: 'English body.' },
          status: 'published',
        },
      });
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'pages',
          slug: 'localized',
          locale: 'es',
          data: { title: 'ES', slug: 'localized', body: 'Cuerpo español.' },
          status: 'draft',
        },
      });
    });

    // Without a locale param, the controller picks any published row — should
    // be the en entry (the es one is a draft and must not appear).
    const noLocale = await fetch(`${baseUrl}/v1/cms/${orgId}/pages/localized`);
    expect(noLocale.status).toBe(200);
    expect(((await noLocale.json()) as { locale: string }).locale).toBe('en');

    // With locale=es: there's no published es entry, so 404 — never a silent
    // fallback to the en entry.
    const esQuery = await fetch(`${baseUrl}/v1/cms/${orgId}/pages/localized?locale=es`);
    expect(esQuery.status).toBe(404);

    // With locale=en: returns the en entry as expected.
    const enQuery = await fetch(`${baseUrl}/v1/cms/${orgId}/pages/localized?locale=en`);
    expect(enQuery.status).toBe(200);
    expect(((await enQuery.json()) as { locale: string }).locale).toBe('en');
  }, 30_000);

  it('delivery: asset fields are expanded inline with publicUrl/mime/altText', async () => {
    const [asset] = await db
      .insert(schema.cmsAssets)
      .values({
        orgId,
        name: 'hero.png',
        mime: 'image/png',
        sizeBytes: 4096,
        storageProvider: 'local',
        storageKey: `cms/${orgId}/it-hero.png`,
        publicUrl: 'https://assets.test/hero.png',
        altText: 'Hero image',
        uploaded: true,
        createdByType: 'user',
        createdById: 'usr_test',
      })
      .returning();
    const assetId = asset!.id;

    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'pages',
          slug: 'with-hero',
          data: {
            title: 'With hero',
            slug: 'with-hero',
            body: 'Body.',
            hero_image: assetId,
          },
          status: 'published',
        },
      });
    });

    const res = await fetchUntil(
      `${baseUrl}/v1/cms/${orgId}/pages/with-hero`,
      (r) => r.status === 200,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { hero_image: unknown } };
    expect(json.data.hero_image).toMatchObject({
      id: assetId,
      publicUrl: 'https://assets.test/hero.png',
      altText: 'Hero image',
      mime: 'image/png',
      sizeBytes: 4096,
    });

    const list = await fetch(`${baseUrl}/v1/cms/${orgId}/pages`);
    const listJson = (await list.json()) as {
      items: Array<{ slug: string; data: { hero_image: unknown } }>;
    };
    const item = listJson.items.find((i) => i.slug === 'with-hero');
    expect(item?.data.hero_image).toMatchObject({ id: assetId });
  }, 30_000);

  it('delivery: pending (not-yet-uploaded) and unknown asset ids surface as null', async () => {
    const [pending] = await db
      .insert(schema.cmsAssets)
      .values({
        orgId,
        name: 'pending.png',
        mime: 'image/png',
        sizeBytes: 100,
        storageProvider: 'local',
        storageKey: `cms/${orgId}/it-pending.png`,
        publicUrl: 'https://assets.test/pending.png',
        uploaded: false,
        createdByType: 'user',
        createdById: 'usr_test',
      })
      .returning();

    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'pages',
          slug: 'with-pending-hero',
          data: {
            title: 'Pending',
            slug: 'with-pending-hero',
            body: 'b',
            hero_image: pending!.id,
          },
          status: 'published',
        },
      });
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'pages',
          slug: 'with-missing-hero',
          data: {
            title: 'Missing',
            slug: 'with-missing-hero',
            body: 'b',
            hero_image: 'cma_nope_does_not_exist',
          },
          status: 'published',
        },
      });
    });

    const pendingRes = await fetchUntil(
      `${baseUrl}/v1/cms/${orgId}/pages/with-pending-hero`,
      (r) => r.status === 200,
    );
    expect(((await pendingRes.json()) as { data: { hero_image: unknown } }).data.hero_image).toBeNull();

    const missingRes = await fetchUntil(
      `${baseUrl}/v1/cms/${orgId}/pages/with-missing-hero`,
      (r) => r.status === 200,
    );
    expect(((await missingRes.json()) as { data: { hero_image: unknown } }).data.hero_image).toBeNull();
  }, 30_000);

  it('end-user agent has no cms_* tools (CMS is admin-only)', async () => {
    await withClient(endUserToken, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name);
      expect(names.find((n) => n.startsWith('cms_'))).toBeFalsy();
    });
  }, 30_000);

  it('analytics: delivery returns _tracking, pixel records a view, beacon records rich attrs', async () => {
    await withClient(adminKey, async (c) => {
      await c.callTool({
        name: 'cms_create_entry',
        arguments: {
          collection: 'pages',
          slug: 'tracked-page',
          data: { title: 'Tracked', slug: 'tracked-page', body: 'Body.' },
          status: 'published',
        },
      });
    });

    const res = await fetchUntil(
      `${baseUrl}/v1/cms/${orgId}/pages/tracked-page`,
      (r) => r.status === 200,
    );
    const entry = (await res.json()) as {
      _tracking?: { pixelUrl: string; beaconUrl: string };
    };
    expect(entry._tracking?.pixelUrl).toMatch(/\/v1\/a\/v\/.+\.gif$/);
    expect(entry._tracking?.beaconUrl).toMatch(/\/v1\/a\/v$/);

    const pixelUrl = retarget(entry._tracking!.pixelUrl, baseUrl);
    const beaconUrl = retarget(entry._tracking!.beaconUrl, baseUrl);

    const beforePixel = await countViewEvents(db, orgId, 'pixel');
    const pixel = await fetch(pixelUrl);
    expect(pixel.status).toBe(200);
    expect(pixel.headers.get('content-type')).toBe('image/gif');
    await waitFor(async () => (await countViewEvents(db, orgId, 'pixel')) > beforePixel);

    const pixelBot = await fetch(pixelUrl, {
      headers: { 'user-agent': 'Googlebot/2.1' },
    });
    expect(pixelBot.status).toBe(200);
    const afterBot = await countViewEvents(db, orgId, 'pixel');
    expect(afterBot).toBe(beforePixel + 1);

    const beforeBeacon = await countViewEvents(db, orgId, 'beacon');
    const tokenMatch = pixelUrl.match(/\/v1\/a\/v\/(.+)\.gif$/);
    const token = tokenMatch![1]!;
    const beacon = await fetch(beaconUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        referrer: 'https://example.com/blog',
        visitorId: 'visitor-xyz',
        dwellMs: 42_000,
        readDepth: 75,
        utm: { source: 'twitter', medium: 'social', campaign: 'launch' },
      }),
    });
    expect(beacon.status).toBe(204);
    await waitFor(async () => (await countViewEvents(db, orgId, 'beacon')) > beforeBeacon);

    const beaconRow = await db
      .select()
      .from(schema.analyticsViewEvents)
      .where(sql`org_id = ${orgId} AND source = 'beacon' AND visitor_id = 'visitor-xyz'`)
      .limit(1);
    expect(beaconRow[0]?.dwellMs).toBe(42_000);
    expect(beaconRow[0]?.readDepth).toBe(75);
    expect(beaconRow[0]?.utmSource).toBe('twitter');
    expect(beaconRow[0]?.subjectType).toBe('cms_entry');

    const tampered = token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    const bad = await fetch(beaconUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: tampered, visitorId: 'should-not-write' }),
    });
    expect(bad.status).toBe(204);
    const tamperedCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.analyticsViewEvents)
      .where(sql`org_id = ${orgId} AND visitor_id = 'should-not-write'`);
    expect(tamperedCount[0]?.n ?? 0).toBe(0);
  }, 30_000);

  it('analytics: ?tracking=0 suppresses the _tracking block', async () => {
    const res = await fetch(`${baseUrl}/v1/cms/${orgId}/pages/tracked-page?tracking=0`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { _tracking?: unknown };
    expect(json._tracking).toBeUndefined();
  }, 30_000);

  it('analytics: public search logs every query with its result_count', async () => {
    const q = `analytics_probe_${Date.now()}`;
    const res = await fetch(
      `${baseUrl}/v1/cms/${orgId}/search?q=${encodeURIComponent(q)}&collection=pages&visitor_id=probe-v`,
    );
    expect(res.status).toBe(200);
    const hits = (await res.json()) as unknown[];
    await waitFor(async () => {
      const rows = await db
        .select()
        .from(schema.analyticsSearchEvents)
        .where(sql`org_id = ${orgId} AND query = ${q}`)
        .limit(1);
      return (
        rows.length > 0 &&
        rows[0]!.resultCount === hits.length &&
        rows[0]!.subjectType === 'cms' &&
        rows[0]!.visitorId === 'probe-v'
      );
    });
  }, 30_000);

  it('createLocale returns an actionable conflict on a duplicate code (not a 500)', async () => {
    await withClient(adminKey, async (c) => {
      await c.callTool({ name: 'cms_create_locale', arguments: { code: 'nl', name: 'Dutch' } });
      const dup = (await c.callTool({
        name: 'cms_create_locale',
        arguments: { code: 'nl', name: 'Dutch (dup)' },
      })) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(dup.isError).toBe(true);
      expect(dup.content?.[0]?.text).toContain('cms_locale_conflict');
    });
  }, 30_000);
});

function retarget(url: string, baseUrl: string): string {
  return url.replace(/^https?:\/\/[^/]+/, baseUrl);
}

async function countViewEvents(
  db: ReturnType<typeof createDb>,
  orgId: string,
  source: 'pixel' | 'beacon',
): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.analyticsViewEvents)
    .where(sql`org_id = ${orgId} AND source = ${source}`);
  return r[0]?.n ?? 0;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
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

async function fetchUntil(
  url: string,
  predicate: (r: Response) => boolean,
  timeoutMs = 2000,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let last = await fetch(url);
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await fetch(url);
  }
  return last;
}
