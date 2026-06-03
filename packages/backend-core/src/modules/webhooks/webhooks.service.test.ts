import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { WebhooksService } from './webhooks.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run webhook service tests.';

(skipReason ? describe.skip : describe)('WebhooksService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: WebhooksService;
  let orgId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Webhooks Service Test Org' })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_wh_test', orgId, ['*'], ['admin']);
    svc = new WebhooksService();
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(
      sql`DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE org_id = ${orgId})`,
    );
    await db.execute(sql`DELETE FROM webhooks WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = actor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: runAs, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  it('create returns secret once; list never exposes it', async () => {
    const created = await run(() =>
      svc.create({ url: 'https://hooks.example.com/h', events: ['cms.entry.published'] }),
    );
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.events).toEqual(['cms.entry.published']);

    const list = await run(() => svc.list());
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);
    expect(list[0]!.secret).toBeUndefined();
  });

  it('create rejects non-https URL', async () => {
    await expect(
      run(() => svc.create({ url: 'http://hooks.example.com/h' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('update patches fields; missing id is 404', async () => {
    const created = await run(() => svc.create({ url: 'https://hooks.example.com/h' }));
    const updated = await run(() =>
      svc.update(created.id, { events: ['crm.contact.created'], active: false }),
    );
    expect(updated.events).toEqual(['crm.contact.created']);
    expect(updated.active).toBe(false);

    await expect(run(() => svc.update('whk_missing', { active: true }))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('delete removes the row; second delete is 404', async () => {
    const created = await run(() => svc.create({ url: 'https://hooks.example.com/h' }));
    await run(() => svc.delete(created.id));
    expect(await run(() => svc.list())).toHaveLength(0);
    await expect(run(() => svc.delete(created.id))).rejects.toThrow(NotFoundException);
  });

  it('rotateSecret returns a fresh whsec_ and persists', async () => {
    const created = await run(() => svc.create({ url: 'https://hooks.example.com/h' }));
    const rotated = await run(() => svc.rotateSecret(created.id));
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);

    const rows = await db
      .select()
      .from(schema.webhooks)
      .where(sql`id = ${created.id}`);
    expect(rows[0]!.secret).toBe(rotated.secret);
  });

  it('rotateSecret 404 on unknown id', async () => {
    await expect(run(() => svc.rotateSecret('whk_missing'))).rejects.toThrow(NotFoundException);
  });

  it('listDeliveries returns rows newest first, filterable by status', async () => {
    const created = await run(() => svc.create({ url: 'https://hooks.example.com/h' }));

    const [evt] = await db
      .insert(schema.events)
      .values({
        orgId,
        type: 'cms.entry.published',
        actorId: actor.id,
        correlationId: 'test',
        payload: {},
      })
      .returning({ id: schema.events.id });
    const eventId = evt!.id;

    await db.insert(schema.webhookDeliveries).values([
      { webhookId: created.id, eventId, attempt: 0, nextAttemptAt: new Date() },
      {
        webhookId: created.id,
        eventId,
        attempt: 1,
        statusCode: 200,
        deliveredAt: new Date(),
        durationMs: 42,
      },
      {
        webhookId: created.id,
        eventId,
        attempt: 5,
        statusCode: 500,
        deliveredAt: new Date(),
        error: 'boom',
      },
    ]);

    const all = await run(() => svc.listDeliveries({ webhookId: created.id }));
    expect(all).toHaveLength(3);

    const pending = await run(() => svc.listDeliveries({ webhookId: created.id, status: 'pending' }));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('pending');

    const delivered = await run(() =>
      svc.listDeliveries({ webhookId: created.id, status: 'delivered' }),
    );
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.statusCode).toBe(200);

    const failed = await run(() => svc.listDeliveries({ webhookId: created.id, status: 'failed' }));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.statusCode).toBe(500);
  });

  it('listDeliveries on unknown webhook is 404', async () => {
    await expect(run(() => svc.listDeliveries({ webhookId: 'whk_missing' }))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('listEventTypes returns module catalogs from packages/types', () => {
    const catalog = svc.listEventTypes();
    expect(catalog.modules.cms).toContain('cms.entry.published');
    expect(catalog.modules.crm).toContain('crm.contact.created');
    expect(catalog.all).toContain('kb.document.created');
    expect(catalog.all.length).toBeGreaterThan(20);
  });
});
