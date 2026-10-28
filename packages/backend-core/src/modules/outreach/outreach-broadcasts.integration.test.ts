import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { BulkEmail, BulkEmailResult } from '../conv/email/email-adapter.ts';
import type { ChannelRow } from '../conv/channels/adapter.ts';
import {
  OutreachBroadcastsService,
  broadcastUnsubscribeUrl,
  type BulkEmailSender,
} from './outreach-broadcasts.service.ts';
import { OutreachBroadcastWorker } from './outreach-broadcast.worker.ts';
import { OutreachBroadcastReplySink } from './outreach-broadcast-reply.sink.ts';
import { OutreachEmailTemplatesService } from './outreach-email-templates.service.ts';
import { OutreachUnsubscribeService } from './outreach-unsubscribe.service.ts';
import { OutreachInvalidError } from './outreach.service.ts';
import { OutreachSendRulesService } from './send-rules.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run outreach broadcast tests.';

class StubSender implements BulkEmailSender {
  readonly sent: { channelId: string; message: BulkEmail }[] = [];
  failFor = new Set<string>();

  sendBulk(channel: ChannelRow, messages: readonly BulkEmail[]): Promise<BulkEmailResult[]> {
    return Promise.resolve(
      messages.map((message) => {
        if (this.failFor.has(message.to)) {
          return { key: message.key, messageId: null, error: 'mailbox unavailable' };
        }
        this.sent.push({ channelId: channel.id, message });
        return { key: message.key, messageId: `${randomUUID()}@acme.test`, error: null };
      }),
    );
  }
}

(skipReason ? describe.skip : describe)('OutreachBroadcastsService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let sender: StubSender;
  let svc: OutreachBroadcastsService;
  let orgId: string;
  let userId: string;
  let agent: ActorIdentity;
  let person: ActorIdentity;
  let channelId: string;
  let segmentId: string;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_API_URL ??= 'https://api.acme.test';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `operator-${randomUUID()}@acme.test`, name: 'Ola Nordmann' })
      .returning();
    userId = user!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId, role: 'owner' });
    agent = new ActorIdentity('admin_agent', 'agt_broadcast_test', orgId, ['*'], ['admin']);
    person = new ActorIdentity('user', userId, orgId, ['*'], ['admin']);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.users).where(sql`id = ${userId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    for (const table of [
      'conv_messages',
      'conv_conversations',
      'conv_contacts',
      'outreach_broadcast_recipients',
      'outreach_broadcasts',
      'outreach_email_templates',
      'crm_activities',
      'crm_address_deliverability',
      'crm_contacts',
      'crm_segments',
      'conv_channels',
    ]) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
    await db.execute(sql`UPDATE orgs SET settings = '{}'::jsonb WHERE id = ${orgId}`);
    sender = new StubSender();
    svc = new OutreachBroadcastsService(new WebhookDispatcher(), sender);

    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'news',
        active: true,
        config: { addressing: { fromAddress: 'news@acme.test', fromName: 'Acme' } },
      })
      .returning();
    channelId = channel!.id;
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({
        orgId,
        name: 'customers',
        filterDefinition: { tagsAny: ['customer'] },
        createdByActorType: 'user',
        createdByActorId: userId,
      })
      .returning();
    segmentId = segment!.id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: as, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  const asAgent = <T>(fn: () => Promise<T>) => runAs(agent, fn);
  const asPerson = <T>(fn: () => Promise<T>) => runAs(person, fn);

  async function contact(values: Partial<typeof schema.crmContacts.$inferInsert> & { name: string }) {
    const [row] = await db
      .insert(schema.crmContacts)
      .values({
        orgId,
        tags: ['customer'],
        consentLawfulBasis: 'contract',
        ...values,
      })
      .returning();
    return row!;
  }

  async function seedAudience() {
    const kari = await contact({ name: 'Kari Nordmann', email: 'kari@example.com' });
    const per = await contact({ name: 'Per Nordmann', email: 'per@example.com' });
    await contact({ name: 'Unsubscribed', email: 'gone@example.com', unsubscribedAt: new Date(), doNotContact: true });
    await contact({ name: 'Blocked', email: 'dnc@example.com', doNotContact: true });
    await contact({ name: 'No basis', email: 'nobasis@example.com', consentLawfulBasis: null });
    await contact({ name: 'No email', email: null });
    await contact({ name: 'Bounced', email: 'bounced@example.com' });
    await contact({ name: 'Kari again', email: ' KARI@example.com ' });
    await contact({ name: 'Not a customer', email: 'prospect@example.com', tags: ['prospect'] });
    await db.insert(schema.crmAddressDeliverability).values({
      orgId,
      address: 'bounced@example.com',
      state: 'undeliverable',
      reason: 'hard_bounce',
      lastFailureAt: new Date(),
    });
    return { kari, per };
  }

  const markdown = { format: 'markdown' as const, body: '# October\n\nHi {{name|there}}, three things shipped.' };

  async function createBroadcast(overrides: Record<string, unknown> = {}) {
    return asAgent(() =>
      svc.createBroadcast({
        name: 'October changelog',
        segmentId,
        channelId,
        subject: 'What is new in October',
        preheader: 'Three things shipped',
        content: markdown,
        ...overrides,
      }),
    );
  }

  it('creates a pending broadcast with a live audience preview and a rendered sample', async () => {
    await seedAudience();
    const b = await createBroadcast();
    expect(b.status).toBe('pending');
    expect(b.audience).toMatchObject({
      eligible: 2,
      frozen: false,
      excluded: {
        unsubscribed: 1,
        do_not_contact: 1,
        no_lawful_basis: 1,
        no_email: 1,
        undeliverable: 1,
        duplicate_address: 1,
      },
    });
    expect(b.audience.sample.map((s) => s.address)).toEqual(['kari@example.com', 'per@example.com']);
    expect(b.preview.recipient.name).toBe('Kari Nordmann');
    expect(b.preview.html).toContain('Hi Kari Nordmann, three things shipped.');
    expect(b.preview.html).toContain('Acme');
    expect(b.preview.text).toContain('Hi Kari Nordmann, three things shipped.');
    expect(b.contentFingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(b.counts.sent).toBe(0);
  });

  it('refuses invalid input before anything is stored', async () => {
    const [chat] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'widget', active: true, config: {} })
      .returning();
    await expect(createBroadcast({ channelId: chat!.id })).rejects.toThrow(/broadcasts are sent on an email channel/);
    await expect(createBroadcast({ emailTemplateId: 'oetp_missing' })).rejects.toThrow(/does not exist/);
    await expect(
      createBroadcast({ content: { format: 'mjml', body: '<mj-text>not a section</mj-text>' } }),
    ).rejects.toBeInstanceOf(OutreachInvalidError);
    await createBroadcast();
    await expect(createBroadcast()).rejects.toBeInstanceOf(ConflictException);
    expect(await asAgent(() => svc.listBroadcasts({}))).toHaveLength(1);
  });

  it('renders through the named template, else the org default, else the built-in layout', async () => {
    await seedAudience();
    const templates = new OutreachEmailTemplatesService();
    const mjml = (footer: string) =>
      `<mjml><mj-body>{{content}}<mj-section><mj-column><mj-text>${footer} <a href="{{unsubscribe_url}}">Unsubscribe</a></mj-text></mj-column></mj-section></mj-body></mjml>`;
    const builtIn = await createBroadcast({ name: 'Built in' });
    expect(builtIn.preview.html).toContain('Unsubscribe');

    const house = await asAgent(() => templates.createTemplate({ name: 'House', mjml: mjml('HOUSE-FOOTER'), isDefault: true }));
    const special = await asAgent(() => templates.createTemplate({ name: 'Special', mjml: mjml('SPECIAL-FOOTER') }));
    expect((await createBroadcast({ name: 'Default' })).preview.html).toContain('HOUSE-FOOTER');
    expect(
      (await createBroadcast({ name: 'Named', emailTemplateId: special.id })).preview.html,
    ).toContain('SPECIAL-FOOTER');

    await expect(asAgent(() => templates.deleteTemplate(special.id))).rejects.toThrow(/used by broadcast "Named"/);
    expect(house.isDefault).toBe(true);
  });

  it('lets only a signed-in person approve, bound to the fingerprint they reviewed', async () => {
    await seedAudience();
    const b = await createBroadcast();

    await expect(
      asAgent(() => svc.approveBroadcast({ id: b.id, fingerprint: b.contentFingerprint })),
    ).rejects.toThrow(/signed-in person/);

    const edited = await asAgent(() =>
      svc.updateBroadcast({ id: b.id, content: { format: 'markdown', body: 'Changed copy for {{name|you}}.' } }),
    );
    expect(edited.contentFingerprint).not.toBe(b.contentFingerprint);
    const stale = await asPerson(() =>
      svc.approveBroadcast({ id: b.id, fingerprint: b.contentFingerprint }),
    ).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(ConflictException);
    expect((stale as ConflictException).getResponse()).toMatchObject({ code: 'outreach_broadcast_changed' });

    await contact({ name: 'Late joiner', email: 'late@example.com' });
    const grown = await asPerson(() =>
      svc.approveBroadcast({ id: b.id, fingerprint: edited.contentFingerprint }),
    ).catch((e: unknown) => e);
    expect(grown).toBeInstanceOf(ConflictException);

    const current = await asAgent(() => svc.getBroadcast(b.id));
    const approved = await asPerson(() =>
      svc.approveBroadcast({ id: b.id, fingerprint: current.contentFingerprint }),
    );
    expect(approved.status).toBe('approved');
    expect(approved.approvedAudienceCount).toBe(3);
    expect(approved.audience.frozen).toBe(true);
    expect(approved.decidedByActorId).toBe(userId);

    await contact({ name: 'After approval', email: 'after@example.com' });
    const recipients = await asAgent(() => svc.listRecipients({ broadcastId: b.id }));
    expect(recipients.items.map((r) => r.address).sort()).toEqual([
      'kari@example.com',
      'late@example.com',
      'per@example.com',
    ]);
    await expect(asAgent(() => svc.updateBroadcast({ id: b.id, subject: 'Too late' }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to approve a broadcast nobody can receive', async () => {
    await contact({ name: 'Unsubscribed', email: 'gone@example.com', unsubscribedAt: new Date(), doNotContact: true });
    const b = await createBroadcast();
    expect(b.audience.eligible).toBe(0);
    await expect(
      asPerson(() => svc.approveBroadcast({ id: b.id, fingerprint: b.contentFingerprint })),
    ).rejects.toThrow(/outreach_broadcast_empty_audience/);
  });

  it('sends in throttled batches, re-checking suppression at send time, then completes', async () => {
    const { kari, per } = await seedAudience();
    const third = await contact({ name: 'Ola Nordmann', email: 'ola@example.com' });
    const b = await createBroadcast();
    const approved = await asPerson(async () =>
      svc.approveBroadcast({ id: b.id, fingerprint: (await svc.getBroadcast(b.id)).contentFingerprint }),
    );
    expect(approved.approvedAudienceCount).toBe(3);

    await db
      .update(schema.crmContacts)
      .set({ unsubscribedAt: new Date(), doNotContact: true })
      .where(eq(schema.crmContacts.id, per.id));
    sender.failFor.add('ola@example.com');

    vi.stubEnv('MUNIN_OUTREACH_BROADCAST_MAX_PER_MINUTE', '2');
    vi.stubEnv('MUNIN_OUTREACH_BROADCAST_POLL_MS', '60000');
    const worker = new OutreachBroadcastWorker(db, svc, sender);

    const first = await worker.tick();
    expect(first.sent + first.failed + first.skipped).toBeLessThanOrEqual(3);
    expect(first.sent + first.failed).toBeLessThanOrEqual(2);

    for (let i = 0; i < 6; i += 1) await worker.tick();

    const done = await asAgent(() => svc.getBroadcast(b.id));
    expect(done.status).toBe('sent');
    expect(done.counts).toMatchObject({ sent: 1, skipped: 1, failed: 1, queued: 0 });
    expect(done.completedAt).not.toBeNull();

    expect(sender.sent).toHaveLength(1);
    const message = sender.sent[0]!.message;
    expect(message.to).toBe('kari@example.com');
    expect(message.subject).toBe('What is new in October');
    expect(message.html).toContain('Hi Kari Nordmann, three things shipped.');
    expect(message.listUnsubscribeUrl).toBe(broadcastUnsubscribeUrl(orgId, kari.id, b.id));
    expect(message.html).toContain(message.listUnsubscribeUrl!.replace(/&/g, '&amp;'));
    expect(message.text).toContain('Hi Kari Nordmann, three things shipped.');

    const recipients = await asAgent(() => svc.listRecipients({ broadcastId: b.id }));
    const byAddress = Object.fromEntries(recipients.items.map((r) => [r.address, r]));
    expect(byAddress['per@example.com']).toMatchObject({ status: 'skipped', skipReason: 'unsubscribed' });
    expect(byAddress['ola@example.com']).toMatchObject({
      status: 'failed',
      failureReason: 'mailbox unavailable',
      attempts: 3,
    });
    expect(byAddress['kari@example.com']!.sentAt).not.toBeNull();
    const [kariAfter] = await db
      .select({ lastContactedAt: schema.crmContacts.lastContactedAt })
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.id, kari.id));
    expect(kariAfter!.lastContactedAt).not.toBeNull();
    expect(third.id).toBeTruthy();
  });

  it('holds back recipients in their quiet hours and skips those over the weekly cap', async () => {
    const { kari, per } = await seedAudience();
    const first = await createBroadcast({ name: 'September changelog' });
    await asPerson(async () =>
      svc.approveBroadcast({ id: first.id, fingerprint: (await svc.getBroadcast(first.id)).contentFingerprint }),
    );
    const worker = new OutreachBroadcastWorker(db, svc, sender);
    for (let i = 0; i < 3; i += 1) await worker.tick();
    expect((await asAgent(() => svc.getBroadcast(first.id))).counts.sent).toBe(2);

    const ola = await contact({ name: 'Ola Nordmann', email: 'ola@example.com' });
    const eva = await contact({ name: 'Eva Nordmann', email: 'eva@example.com', customFields: { timezone: 'Pacific/Kiritimati' } });
    const now = Date.now();
    const hhmm = (at: number) => new Date(at).toISOString().slice(11, 16);
    await asAgent(() =>
      new OutreachSendRulesService().configure({
        timezone: 'UTC',
        quietHours: `${hhmm(now - 60 * 60_000)}-${hhmm(now + 120 * 60_000)}`,
        validDays: null,
        weeklyCap: 1,
        cooldownHoursAfterConversation: 0,
      }),
    );
    const second = await createBroadcast({ name: 'October changelog' });
    await asPerson(async () =>
      svc.approveBroadcast({ id: second.id, fingerprint: (await svc.getBroadcast(second.id)).contentFingerprint }),
    );
    for (let i = 0; i < 3; i += 1) await worker.tick();

    const recipients = await asAgent(() => svc.listRecipients({ broadcastId: second.id }));
    const byContact = new Map(recipients.items.map((r) => [r.contactId, r]));
    expect(byContact.get(kari.id)).toMatchObject({ status: 'skipped', skipReason: 'frequency_cap' });
    expect(byContact.get(per.id)).toMatchObject({ status: 'skipped', skipReason: 'frequency_cap' });
    expect(byContact.get(eva.id)).toMatchObject({ status: 'sent' });
    expect(byContact.get(ola.id)).toMatchObject({ status: 'queued' });
    const [held] = await db
      .select({ notBefore: schema.outreachBroadcastRecipients.notBefore })
      .from(schema.outreachBroadcastRecipients)
      .where(eq(schema.outreachBroadcastRecipients.id, byContact.get(ola.id)!.id));
    expect(held!.notBefore!.getTime()).toBeGreaterThan(now);
    expect((await asAgent(() => svc.getBroadcast(second.id))).status).toBe('sending');
  });

  it('honours a future send time and an hourly limit', async () => {
    await seedAudience();
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const b = await createBroadcast({ maxPerHour: 1 });
    await asPerson(async () =>
      svc.approveBroadcast({ id: b.id, fingerprint: (await svc.getBroadcast(b.id)).contentFingerprint, sendAt: later }),
    );
    const worker = new OutreachBroadcastWorker(db, svc, sender);
    await worker.tick();
    expect(sender.sent).toHaveLength(0);

    await db
      .update(schema.outreachBroadcasts)
      .set({ scheduledSendAt: new Date(Date.now() - 1000) })
      .where(eq(schema.outreachBroadcasts.id, b.id));
    await worker.tick();
    await worker.tick();
    expect(sender.sent).toHaveLength(1);
    expect((await asAgent(() => svc.getBroadcast(b.id))).status).toBe('sending');
  });

  it('returns a broadcast called off before it starts to review, with nothing sent', async () => {
    await seedAudience();
    const b = await createBroadcast();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await asPerson(async () =>
      svc.approveBroadcast({ id: b.id, fingerprint: (await svc.getBroadcast(b.id)).contentFingerprint, sendAt: tomorrow }),
    );

    const returned = await asAgent(() => svc.cancelBroadcast({ id: b.id, reason: 'wrong date in the copy' }));
    expect(returned).toMatchObject({
      status: 'pending',
      cancelReason: 'wrong date in the copy',
      scheduledSendAt: null,
      decidedAt: null,
      approvedAudienceCount: null,
    });
    expect(returned.audience.frozen).toBe(false);
    expect(await asAgent(() => svc.listRecipients({ broadcastId: b.id }))).toEqual({ items: [], nextCursor: null });
    expect((await asAgent(() => svc.listDecided({}))).map((d) => d.id)).not.toContain(b.id);

    const edited = await asAgent(() => svc.updateBroadcast({ id: b.id, subject: 'What is new in October, corrected' }));
    const reapproved = await asPerson(() =>
      svc.approveBroadcast({ id: b.id, fingerprint: edited.contentFingerprint }),
    );
    expect(reapproved).toMatchObject({ status: 'approved', cancelReason: null, approvedAudienceCount: 2 });
    await new OutreachBroadcastWorker(db, svc, sender).tick();
    expect(sender.sent.map((s) => s.message.subject)).toEqual([
      'What is new in October, corrected',
      'What is new in October, corrected',
    ]);
  });

  it('stops a broadcast mid-send, skipping everyone not yet sent to', async () => {
    await seedAudience();
    const b = await createBroadcast();
    await asPerson(async () =>
      svc.approveBroadcast({ id: b.id, fingerprint: (await svc.getBroadcast(b.id)).contentFingerprint }),
    );
    vi.stubEnv('MUNIN_OUTREACH_BROADCAST_MAX_PER_MINUTE', '1');
    const worker = new OutreachBroadcastWorker(db, svc, sender);
    await worker.tick();
    expect(sender.sent).toHaveLength(1);

    const stopped = await asAgent(() => svc.cancelBroadcast({ id: b.id, reason: 'wrong date in the copy' }));
    expect(stopped.status).toBe('cancelled');
    expect(stopped.counts).toMatchObject({ sent: 1, skipped: 1, queued: 0 });
    await worker.tick();
    expect(sender.sent).toHaveLength(1);
    await expect(asAgent(() => svc.cancelBroadcast({ id: b.id, reason: 'again' }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('dismisses a pending broadcast and keeps the reason', async () => {
    const b = await createBroadcast();
    const dismissed = await asAgent(() => svc.dismissBroadcast({ id: b.id, reason: 'merge into November' }));
    expect(dismissed).toMatchObject({ status: 'dismissed', dismissReason: 'merge into November' });
  });

  it('sends a test only to members of the organization', async () => {
    const b = await createBroadcast();
    const [member] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
    const result = await asPerson(() => svc.sendBroadcastTest({ id: b.id }));
    expect(result).toMatchObject({ sent: true, to: member!.email });
    expect(sender.sent[0]!.message.subject).toBe('[Test] What is new in October');

    await expect(
      asAgent(() => svc.sendBroadcastTest({ id: b.id, to: 'outsider@example.com' })),
    ).rejects.toThrow(/only to members/);
    await expect(asAgent(() => svc.sendBroadcastTest({ id: b.id }))).rejects.toThrow(/pass `to`/);
    expect((await asAgent(() => svc.sendBroadcastTest({ id: b.id, to: member!.email.toUpperCase() }))).to).toBe(
      member!.email,
    );
  });

  it('credits an unsubscribe from a broadcast link to that broadcast’s recipient', async () => {
    const { kari } = await seedAudience();
    const b = await createBroadcast();
    await asPerson(async () =>
      svc.approveBroadcast({ id: b.id, fingerprint: (await svc.getBroadcast(b.id)).contentFingerprint }),
    );
    await new OutreachBroadcastWorker(db, svc, sender).tick();

    const token = new URL(broadcastUnsubscribeUrl(orgId, kari.id, b.id)).searchParams.get('token')!;
    const unsub = new OutreachUnsubscribeService(db, new WebhookDispatcher());
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    expect(await unsub.unsubscribe(token, 'one_click')).toMatchObject({ state: 'unsubscribed' });

    const after = await asAgent(() => svc.getBroadcast(b.id));
    expect(after.counts.unsubscribed).toBe(1);    const [event] = await db
      .select({ payload: schema.events.payload })
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'crm.contact.unsubscribed')));
    expect(event!.payload).toEqual({ contactId: kari.id, broadcastId: b.id, method: 'one_click' });
  });

  it('seeds the broadcast into the reply conversation once, dated when it was sent', async () => {
    const { kari } = await seedAudience();
    const b = await createBroadcast();
    await asPerson(async () =>
      svc.approveBroadcast({ id: b.id, fingerprint: (await svc.getBroadcast(b.id)).contentFingerprint }),
    );
    await new OutreachBroadcastWorker(db, svc, sender).tick();
    const [recipient] = await db
      .select()
      .from(schema.outreachBroadcastRecipients)
      .where(
        and(
          eq(schema.outreachBroadcastRecipients.broadcastId, b.id),
          eq(schema.outreachBroadcastRecipients.contactId, kari.id),
        ),
      );
    const [convContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: 'kari@example.com', name: 'Kari Nordmann' })
      .returning();
    const conversationId = `ccv_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await db.insert(schema.convConversations).values({
      id: conversationId,
      orgId,
      displayId: 9001,
      channelId,
      contactId: convContact!.id,
      status: 'open',
      outreachBroadcastId: b.id,
      agentMode: 'draft_only',
      lastMessageAt: new Date(),
    });
    await db
      .update(schema.outreachBroadcastRecipients)
      .set({ conversationId })
      .where(eq(schema.outreachBroadcastRecipients.id, recipient!.id));

    const sink = new OutreachBroadcastReplySink();
    const event = (autoReply: boolean) => ({
      id: randomUUID(),
      type: 'conversation.message.received',
      payload: { conversationId, authorType: 'end_user', ...(autoReply ? { autoReply: true } : {}) },
    });
    await asAgent(() => sink.onEvent(event(true) as never));
    expect(await messagesIn(conversationId)).toHaveLength(0);

    await asAgent(() => sink.onEvent(event(false) as never));
    await asAgent(() => sink.onEvent(event(false) as never));
    const seeded = await messagesIn(conversationId);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ authorType: 'user', authorId: userId });
    expect(seeded[0]!.body).toContain('Hi Kari Nordmann, three things shipped.');
    expect(seeded[0]!.createdAt.toISOString()).toBe(recipient!.sentAt!.toISOString());

    const after = await asAgent(() => svc.getBroadcast(b.id));
    expect(after.counts.replied).toBe(1);
  });

  async function messagesIn(conversationId: string) {
    return db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, conversationId));
  }
});
