import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';
import { SnoozeWakeWorker } from './snooze-wake.worker.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to run conv snooze-wake integration tests.';

(skipReason ? describe.skip : describe)('conv snooze wake worker', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDb>;
  let worker: SnoozeWakeWorker;
  let orgId: string;
  let channelId: string;
  let displayCounter = 0;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Snooze Wake Org' })
      .returning();
    orgId = org!.id;

    const [chat] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'sw-chat',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();
    channelId = chat!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    worker = app.get(SnoozeWakeWorker);
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function mkConv(opts: {
    status: 'open' | 'snoozed';
    snoozeUntil?: Date | null;
  }): Promise<string> {
    displayCounter += 1;
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId,
        displayId: displayCounter,
        status: opts.status,
        snoozeUntil: opts.snoozeUntil ?? null,
      })
      .returning();
    return conv!.id;
  }

  async function read(id: string) {
    const [row] = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, id));
    return row!;
  }

  it('wakes a snoozed conversation whose snooze_until has elapsed', async () => {
    const id = await mkConv({
      status: 'snoozed',
      snoozeUntil: new Date(Date.now() - 60_000),
    });
    const result = await worker.tick();
    expect(result.woken).toBeGreaterThanOrEqual(1);
    const row = await read(id);
    expect(row.status).toBe('open');
    expect(row.snoozeUntil).toBeNull();
    expect(row.needsHumanAttention).toBe(true);
    expect(row.needsHumanAttentionAt).not.toBeNull();
  });

  it('leaves a conversation snoozed while snooze_until is in the future', async () => {
    const id = await mkConv({
      status: 'snoozed',
      snoozeUntil: new Date(Date.now() + 60 * 60_000),
    });
    await worker.tick();
    const row = await read(id);
    expect(row.status).toBe('snoozed');
    expect(row.needsHumanAttention).toBe(false);
  });

  it('does not touch open conversations', async () => {
    const id = await mkConv({ status: 'open' });
    await worker.tick();
    const row = await read(id);
    expect(row.status).toBe('open');
    expect(row.needsHumanAttention).toBe(false);
  });
});
