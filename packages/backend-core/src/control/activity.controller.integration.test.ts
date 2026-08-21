import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { AGENT_HOST_ACTOR_PREFIX, SYSTEM_ACTOR_IDS } from '@getmunin/types';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run activity actor integration tests.';

interface ActivityRow {
  actorId: string | null;
  actorKind: string | null;
  actorLabel: string | null;
}

(skipReason ? describe.skip : describe)('Activity actor resolution', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let adminKeyId: string;
  let widgetKeyId: string;
  let trackerKeyId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Activity Actors Org' }).returning();
    orgId = org!.id;

    const [user] = await db
      .insert(schema.users)
      .values({
        id: randomUUID().replace(/-/g, '').slice(0, 32),
        email: `nora-${randomUUID().slice(0, 8)}@test.example`,
        name: 'Nora',
      })
      .returning();
    userId = user!.id;

    adminKey = buildApiKey('admin');
    const [admin] = await db
      .insert(schema.apiKeys)
      .values({
        orgId,
        type: 'admin',
        name: 'Deploy key',
        keyHash: hashSecret(adminKey),
        keyPrefix: keyPrefix(adminKey),
        scopes: ['*'],
      })
      .returning();
    adminKeyId = admin!.id;

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'widget', vendor: 'munin', name: 'Site chat' })
      .returning();

    const widgetSecret = buildApiKey('widget');
    const [widget] = await db
      .insert(schema.apiKeys)
      .values({
        orgId,
        type: 'widget',
        name: 'Site widget',
        keyHash: hashSecret(widgetSecret),
        keyPrefix: keyPrefix(widgetSecret),
        scopes: ['conv:write'],
        channelId: channel!.id,
      })
      .returning();
    widgetKeyId = widget!.id;

    const [trackerRow] = await db
      .insert(schema.analyticsTrackers)
      .values({ orgId, name: 'Marketing site' })
      .returning();

    const trackerSecret = buildApiKey('track');
    const [tracker] = await db
      .insert(schema.apiKeys)
      .values({
        orgId,
        type: 'track',
        name: 'Marketing tracker',
        keyHash: hashSecret(trackerSecret),
        keyPrefix: keyPrefix(trackerSecret),
        scopes: ['analytics:write'],
        trackerId: trackerRow!.id,
      })
      .returning();
    trackerKeyId = tracker!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.users).where(sql`id = ${userId}`);
      void db.$client.end();
    }
  });

  async function seedEvent(actorId: string): Promise<void> {
    await db.insert(schema.events).values({
      orgId,
      type: 'kb.document_created',
      actorId,
      payload: {},
    });
  }

  async function feed(): Promise<ActivityRow[]> {
    const res = await fetch(`${baseUrl}/v1/activity`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ActivityRow[] };
    return body.items;
  }

  it('names an admin API key caller and classifies it as an agent, not a widget', async () => {
    await db.delete(schema.events).where(sql`org_id = ${orgId}`);
    await seedEvent(adminKeyId);

    const items = await feed();
    expect(items).toEqual([
      expect.objectContaining({ actorKind: 'agent', actorLabel: 'Deploy key' }),
    ]);
  });

  it('classifies widget and tracker keys as widgets and names them', async () => {
    await db.delete(schema.events).where(sql`org_id = ${orgId}`);
    await seedEvent(widgetKeyId);
    await seedEvent(trackerKeyId);

    const items = await feed();
    expect(new Set(items.map((i) => `${i.actorKind}:${i.actorLabel}`))).toEqual(
      new Set(['widget:Site widget', 'widget:Marketing tracker']),
    );
  });

  it('resolves a BetterAuth-generated user id to the person', async () => {
    await db.delete(schema.events).where(sql`org_id = ${orgId}`);
    await seedEvent(userId);

    const items = await feed();
    expect(items).toEqual([expect.objectContaining({ actorKind: 'user', actorLabel: 'Nora' })]);
  });

  it('classifies the in-process agent runtime as an agent, per-org and per-end-user', async () => {
    await db.delete(schema.events).where(sql`org_id = ${orgId}`);
    await seedEvent(`${AGENT_HOST_ACTOR_PREFIX}${orgId}`);
    await seedEvent(`${AGENT_HOST_ACTOR_PREFIX}${orgId}:eu_someone`);

    const items = await feed();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.actorKind === 'agent')).toBe(true);
  });

  it('classifies the scheduler and read-tracker actors as system', async () => {
    await db.delete(schema.events).where(sql`org_id = ${orgId}`);
    for (const id of SYSTEM_ACTOR_IDS) await seedEvent(id);

    const items = await feed();
    expect(items).toHaveLength(SYSTEM_ACTOR_IDS.length);
    expect(items.every((i) => i.actorKind === 'system')).toBe(true);
  });

  it('reports an actor it cannot place as unknown rather than guessing from its id shape', async () => {
    await db.delete(schema.events).where(sql`org_id = ${orgId}`);
    await seedEvent('usr_looks_like_a_user_but_is_not');

    const items = await feed();
    expect(items).toEqual([
      expect.objectContaining({ actorKind: 'unknown', actorLabel: null }),
    ]);
  });
});
