import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type MailMessage,
  type Mailer,
  type RequestContext,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { AlertsService } from './system-alerts.service.ts';
import { AlertNotificationSink } from './alert-notification.sink.ts';
import { AlertNotificationWorker, MAX_NOTIFY_ATTEMPTS } from './alert-notification.worker.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run alert-notification integration tests.';

class RecordingMailer implements Mailer {
  readonly name = 'recording';
  readonly from = 'alerts@example.test';
  readonly sent: MailMessage[] = [];
  failWith: Error | null = null;

  send(msg: MailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(msg);
    return Promise.resolve();
  }
}

(skipReason ? describe.skip : describe)('alert notifications', () => {
  let svcDb: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let ownerOne: string;
  let ownerTwo: string;
  let plainMember: string;

  const dispatcher = new WebhookDispatcher();
  const service = new AlertsService(dispatcher);
  const mailer = new RecordingMailer();
  let worker: AlertNotificationWorker;

  async function asActor(userId: string | undefined, fn: () => Promise<void>): Promise<void> {
    const actor = new ActorIdentity(
      'user',
      userId ?? 'system',
      orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, fn);
    });
  }

  async function notifications() {
    return await svcDb
      .select()
      .from(schema.alertNotifications)
      .where(eq(schema.alertNotifications.orgId, orgId));
  }

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    svcDb = createDb(TEST_URL!, { serviceRole: true });
    appDb = createDb(
      TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@'),
    );
    dispatcher.registerSink(new AlertNotificationSink());
    worker = new AlertNotificationWorker(svcDb, mailer);

    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await svcDb.insert(schema.orgs).values({ name: 'Acme Alerts' }).returning();
    orgId = org!.id;

    const inserted = await svcDb
      .insert(schema.users)
      .values([
        { name: 'Ola Nordmann', email: `owner1-${randomUUID()}@example.test` },
        { name: 'Kari Nordmann', email: `owner2-${randomUUID()}@example.test` },
        { name: 'Per Hansen', email: `member-${randomUUID()}@example.test` },
      ])
      .returning();
    ownerOne = inserted[0]!.id;
    ownerTwo = inserted[1]!.id;
    plainMember = inserted[2]!.id;

    await svcDb.insert(schema.orgMembers).values([
      { orgId, userId: ownerOne, role: 'owner' },
      { orgId, userId: ownerTwo, role: 'owner' },
      { orgId, userId: plainMember, role: 'member' },
    ]);
  });

  afterAll(async () => {
    if (!svcDb) return;
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await svcDb.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    await svcDb
      .delete(schema.users)
      .where(sql`id IN (${ownerOne}, ${ownerTwo}, ${plainMember})`);
  });

  beforeEach(async () => {
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await svcDb.delete(schema.alertNotifications);
    await svcDb.delete(schema.orgAlerts);
    mailer.sent.length = 0;
    mailer.failWith = null;
  });

  it('fans an org-scoped alert out to every owner and nobody else', async () => {
    await asActor(ownerOne, async () => {
      await service.openAlert({
        source: 'llm_provider',
        subjectId: 'provider',
        severity: 'error',
        title: 'Provider unreachable',
      });
    });

    const rows = await notifications();
    expect(rows.map((r) => r.recipientUserId).sort()).toEqual([ownerOne, ownerTwo].sort());
    expect(rows.some((r) => r.recipientUserId === plainMember)).toBe(false);
  });

  it('sends a user-scoped alert only to the affected member, owner or not', async () => {
    await asActor(plainMember, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: plainMember,
        severity: 'warning',
        title: 'LinkedIn connection expired',
      });
    });

    const rows = await notifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipientUserId).toBe(plainMember);
  });

  it('does not enqueue a second time when an alert repeats', async () => {
    await asActor(ownerOne, async () => {
      for (let i = 0; i < 3; i += 1) {
        await service.openAlert({
          source: 'llm_provider',
          subjectId: 'provider',
          severity: 'error',
          title: `attempt ${i}`,
        });
      }
    });

    const alerts = await svcDb.select().from(schema.orgAlerts);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.occurrenceCount).toBe(3);
    expect(await notifications()).toHaveLength(2);
  });

  it('honours the per-source notify policy', async () => {
    await asActor(ownerOne, async () => {
      await service.openAlert({
        source: 'curator',
        subjectId: 'job',
        severity: 'error',
        title: 'dashboard only',
      });
      await service.openAlert({
        source: 'channel_inbound',
        subjectId: 'channel',
        severity: 'warning',
        title: 'below the error floor',
      });
    });
    expect(await notifications()).toHaveLength(0);

    await asActor(ownerOne, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: ownerOne,
        severity: 'warning',
        title: 'warning is enough for social',
      });
    });
    expect(await notifications()).toHaveLength(1);
  });

  it('enqueues nothing while alert emails are switched off', async () => {
    process.env.MUNIN_ALERT_EMAILS_DISABLED = '1';
    try {
      await asActor(ownerOne, async () => {
        await service.openAlert({
          source: 'llm_provider',
          subjectId: 'provider',
          severity: 'error',
          title: 'muted',
        });
      });
      expect(await notifications()).toHaveLength(0);
    } finally {
      delete process.env.MUNIN_ALERT_EMAILS_DISABLED;
    }
  });

  it('drains a pending notification and marks it delivered', async () => {
    await asActor(plainMember, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: plainMember,
        severity: 'warning',
        title: 'LinkedIn connection expired',
        detail: 'refresh token rejected',
        ctaHref: 'https://app.example/dashboard',
      });
    });

    const result = await worker.tick();
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toContain('LinkedIn connection expired');
    expect(mailer.sent[0]!.text).toContain('refresh token rejected');
    expect(mailer.sent[0]!.text).toContain('Nobody else can clear this one for you');

    const rows = await notifications();
    expect(rows[0]!.deliveredAt).not.toBeNull();
    expect(rows[0]!.error).toBeNull();

    expect(await worker.tick()).toEqual({ sent: 0, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
  });

  it('sends the cta as an absolute url, not the stored relative path', async () => {
    const previous = process.env.MUNIN_WEB_URL;
    process.env.MUNIN_WEB_URL = 'https://app.example.com';
    try {
      await asActor(plainMember, async () => {
        await service.openAlert({
          source: 'social',
          subjectId: 'linkedin-cta',
          userId: plainMember,
          severity: 'warning',
          title: 'Reconnect LinkedIn',
          ctaHref: '/dashboard/settings/integrations',
        });
      });

      await worker.tick();
      const sent = mailer.sent.at(-1)!;
      expect(sent.text).toContain('https://app.example.com/dashboard/settings/integrations');
      expect(sent.text).not.toContain('"/dashboard/settings/integrations"');
    } finally {
      if (previous === undefined) delete process.env.MUNIN_WEB_URL;
      else process.env.MUNIN_WEB_URL = previous;
    }
  });

  it('skips an alert that resolved before the worker reached it', async () => {
    await asActor(ownerOne, async () => {
      await service.openAlert({
        source: 'llm_provider',
        subjectId: 'provider',
        severity: 'error',
        title: 'transient',
      });
      await service.resolveAlert({ source: 'llm_provider', subjectId: 'provider' });
    });

    const result = await worker.tick();
    expect(result.sent).toBe(2);
    expect(mailer.sent).toHaveLength(0);
    expect((await notifications()).every((r) => r.deliveredAt !== null)).toBe(true);
  });

  it('backs off on a send failure and gives up after the attempt ceiling', async () => {
    await asActor(plainMember, async () => {
      await service.openAlert({
        source: 'social',
        subjectId: 'linkedin',
        userId: plainMember,
        severity: 'warning',
        title: 'LinkedIn connection expired',
      });
    });

    mailer.failWith = new Error('smtp refused');
    for (let attempt = 1; attempt <= MAX_NOTIFY_ATTEMPTS; attempt += 1) {
      const result = await worker.tick();
      expect(result).toEqual({ sent: 0, failed: 1 });
      const [row] = await notifications();
      expect(row!.attempt).toBe(attempt);
      expect(row!.error).toContain('smtp refused');
      if (attempt < MAX_NOTIFY_ATTEMPTS) {
        expect(row!.deliveredAt).toBeNull();
        await svcDb
          .update(schema.alertNotifications)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(schema.alertNotifications.id, row!.id));
      }
    }

    const [row] = await notifications();
    expect(row!.deliveredAt).not.toBeNull();
    expect(await worker.tick()).toEqual({ sent: 0, failed: 0 });
  });
});
