import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { EmailService } from '../email/email.service.ts';
import { ChannelCredentialService } from './channel-credential.service.ts';
import { CredentialHandoffService } from '../../credential-handoff/credential-handoff.service.ts';
import { CredentialTargetRegistry } from '../../credential-handoff/credential-target.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run channel credential-handoff tests.';

(skipReason ? describe.skip : describe)('ChannelCredentialService (email)', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let handoff: CredentialHandoffService;
  let channels: ChannelCredentialService;
  let orgId: string;
  let channelId: string;
  let adminActor: ActorIdentity;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_KEY_PEPPER ??= 'integration-test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Channel Handoff Org' }).returning();
    orgId = org!.id;
    adminActor = new ActorIdentity('admin_agent', 'agt_ch', orgId, ['*'], ['admin']);

    const targets = new CredentialTargetRegistry();
    handoff = new CredentialHandoffService(db, targets);
    const email = new EmailService();
    channels = new ChannelCredentialService(email, handoff);
    targets.register(channels);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM credential_requests WHERE org_id = ${orgId}`);
    await db.delete(schema.convChannels).where(sql`org_id = ${orgId}`);
    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'Support inbox',
        config: {
          addressing: { fromAddress: 'support@acme.test' },
          outbound: {
            provider: 'smtp',
            host: 'smtp.acme.test',
            port: 587,
            secure: true,
            username: 'support@acme.test',
            encryptedPassword: '',
          },
          inbound: {
            provider: 'imap',
            host: 'imap.acme.test',
            port: 993,
            secure: true,
            username: 'support@acme.test',
            encryptedPassword: '',
          },
        },
      })
      .returning();
    channelId = channel!.id;
  });

  function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: adminActor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  function tokenFromUrl(url: string): string {
    return new URL(url).searchParams.get('token')!;
  }

  it('mints a link, describes the secret fields, and stores the passwords encrypted', async () => {
    const link = await asAdmin(() => channels.requestLink(channelId));
    expect(link.url).toContain('/connect/credentials?token=mncl_');

    const token = tokenFromUrl(link.url);
    const described = await handoff.describe(token);
    expect(described.vendor).toBe('email');
    expect(described.fields.map((f) => f.key).sort()).toEqual(['imapPassword', 'smtpPassword']);

    const result = await handoff.complete(token, {
      smtpPassword: 'smtp_secret_pw',
      imapPassword: 'imap_secret_pw',
    });
    expect(result.ok).toBe(true);

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.select().from(schema.convChannels).where(sql`id = ${channelId}`);
    const config = rows[0]!.config as {
      outbound: { encryptedPassword: string };
      inbound: { encryptedPassword: string };
    };
    expect(config.outbound.encryptedPassword.length).toBeGreaterThan(0);
    expect(config.inbound.encryptedPassword.length).toBeGreaterThan(0);
    expect(JSON.stringify(config)).not.toContain('smtp_secret_pw');
    expect(JSON.stringify(config)).not.toContain('imap_secret_pw');

    await expect(
      handoff.complete(token, { smtpPassword: 'again' }),
    ).rejects.toThrow(/invalid or expired/);
  });

  it('refuses a credential link for a non-email channel', async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [sms] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'sms', vendor: 'twilio', name: 'SMS', config: {} })
      .returning();
    await expect(asAdmin(() => channels.requestLink(sms!.id))).rejects.toThrow(/only.*email/);
  });
});
