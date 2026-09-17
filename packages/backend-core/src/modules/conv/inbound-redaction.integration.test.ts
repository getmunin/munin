import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and, desc } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';
import { EmailAdapter, parseMessage } from './email/email-adapter.ts';
import { REDACTION_SETTINGS_KEY } from './redaction-policy.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run redaction integration tests.';

const NO_SYNTHETIC = '01819012365';

(skipReason ? describe.skip : describe)('Inbound national-ID redaction', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adapter: EmailAdapter;
  let channel: typeof schema.convChannels.$inferSelect;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';

    await runMigrations(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Redaction IT Org' }).returning();
    orgId = org!.id;

    const [inserted] = await db.insert(schema.convChannels).values({
      orgId,
      type: 'email',
      vendor: 'mailer',
      name: 'Redaction Support',
      active: true,
      config: {
        addressing: { fromAddress: 'support@acme.test', fromName: 'Acme' },
        outbound: { provider: 'mailer' },
        inbound: {
          provider: 'imap',
          host: 'imap.acme.test',
          port: 993,
          secure: true,
          username: 'support@acme.test',
          mailbox: 'INBOX',
        },
      },
    }).returning();
    channel = inserted!;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    adapter = app.get(EmailAdapter);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    }
  });

  async function setPolicy(value: Record<string, unknown> | null): Promise<void> {
    await db
      .update(schema.orgs)
      .set({ settings: value ? { [REDACTION_SETTINGS_KEY]: value } : {} })
      .where(eq(schema.orgs.id, orgId));
  }

  async function deliver(raw: string): Promise<void> {
    await adapter.ingest(channel, await parseMessage(raw));
  }

  async function newestMessage(): Promise<typeof schema.convMessages.$inferSelect> {
    const rows = await db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.orgId, orgId))
      .orderBy(desc(schema.convMessages.ingestedAt))
      .limit(1);
    return rows[0]!;
  }

  it('records a detection without touching the body while the policy is off', async () => {
    await setPolicy(null);
    await deliver(
      rfc822({
        from: 'Kari Nordmann <kari@kunde.no>',
        subject: 'Søknad',
        messageId: 'redaction-off@kunde.no',
        body: `Hei, mitt fødselsnummer er ${NO_SYNTHETIC}. Mvh Kari`,
      }),
    );

    const msg = await newestMessage();
    expect(msg.body).toContain(NO_SYNTHETIC);
    expect(msg.metadata.detectedNationalIds).toEqual([
      { detector: 'no_fnr', confidence: 'high', count: 1 },
    ]);
  });

  it('raises a data-protection alert an operator can act on', async () => {
    const alerts = await db
      .select()
      .from(schema.orgAlerts)
      .where(and(eq(schema.orgAlerts.orgId, orgId), eq(schema.orgAlerts.source, 'data_protection')));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.detail).toContain('fødselsnummer');
  });

  it('scrubs every persisted copy once the policy is on', async () => {
    await setPolicy({ detectors: ['no_fnr'], policy: 'remove', minConfidence: 'high' });
    await deliver(
      rfc822({
        from: 'Ola Nordmann <ola@kunde.no>',
        subject: `Sak for ${NO_SYNTHETIC}`,
        messageId: 'redaction-on@kunde.no',
        body: [
          `Fødselsnummeret mitt er ${NO_SYNTHETIC}.`,
          '',
          'On Mon, 1 Jan 2024, Acme Support wrote:',
          `> Kan du bekrefte ${NO_SYNTHETIC}?`,
          '',
          '--',
          `Ola Nordmann, ${NO_SYNTHETIC}`,
        ].join('\r\n'),
      }),
    );

    const msg = await newestMessage();
    const everything = JSON.stringify({
      body: msg.body,
      bodyHtml: msg.bodyHtml,
      metadata: msg.metadata,
    });
    expect(everything).not.toContain(NO_SYNTHETIC);
    expect(everything).not.toContain('018190');
    expect(msg.body).toContain('[fødselsnummer fjernet]');

    const convs = await db
      .select({ subject: schema.convConversations.subject })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, msg.conversationId));
    expect(convs[0]!.subject).not.toContain(NO_SYNTHETIC);
  });

  it('leaves a detector the org did not enable alone, but still reports it', async () => {
    await setPolicy({ detectors: ['no_fnr'], policy: 'remove', minConfidence: 'high' });
    await deliver(
      rfc822({
        from: 'Jens Hansen <jens@kunde.no>',
        subject: 'CPR',
        messageId: 'redaction-dk@kunde.no',
        body: 'Mit CPR-nummer er 010190-1234.',
      }),
    );

    const msg = await newestMessage();
    expect(msg.body).toContain('010190-1234');
    expect(msg.metadata.detectedNationalIds).toEqual([
      { detector: 'dk_cpr', confidence: 'high', count: 1 },
    ]);
  });
});

function rfc822(input: {
  from: string;
  subject: string;
  messageId: string;
  body: string;
}): string {
  return [
    `From: ${input.from}`,
    'To: support@acme.test',
    `Subject: ${input.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${input.messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    input.body,
    '',
  ].join('\r\n');
}
