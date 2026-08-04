import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sensitive } from '@getmunin/types';
import { getCurrentContext } from '@getmunin/core';
import { eq } from 'drizzle-orm';
import { EmailService } from '../email/email.service.ts';
import {
  ChannelCredentialService,
  type EmailChannelTester,
} from './channel-credential.service.ts';
import { ChannelAdminService } from './channel-admin.service.ts';
import {
  PENDING_SETUP_KEY,
  describeConfigFields,
  readPendingSetup,
  type ChannelAdminDto,
  type ChannelAdminProvider,
  type CompleteSetupResult,
  type ConfigureChannelInput,
} from './channel-admin.ts';
import { CredentialHandoffService } from '../../credential-handoff/credential-handoff.service.ts';
import { CredentialTargetRegistry } from '../../credential-handoff/credential-target.ts';

class FakeSmsProvider implements ChannelAdminProvider {
  readonly kind = 'sms' as const;
  readonly vendor = 'fakesms';
  readonly displayName = 'Fake SMS';
  readonly configInput = z.object({
    sender: z.string().min(1),
    apiToken: sensitive(z.string().min(1).optional()),
  });
  readonly configFields = describeConfigFields(this.configInput);
  readonly capabilities = { call: false, sendTest: false };
  testResult: CompleteSetupResult = { ok: true };

  configure(_input: ConfigureChannelInput): Promise<ChannelAdminDto> {
    return Promise.reject(new Error('not used in this test'));
  }

  test(): Promise<unknown> {
    return Promise.resolve(this.testResult);
  }

  validatePendingConfig(config: Record<string, unknown>): Record<string, unknown> {
    const parsed = z.object({ sender: z.string().min(1) }).parse(config);
    return parsed;
  }

  async completeSetup(
    channelId: string,
    secrets: Record<string, string>,
  ): Promise<CompleteSetupResult> {
    if (!secrets.apiToken) return { ok: false, error: 'apiToken missing' };
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const pending = readPendingSetup(rows[0]!.config) ?? {};
    await ctx.db
      .update(schema.convChannels)
      .set({
        config: { sender: pending.sender, encryptedApiToken: `enc(${secrets.apiToken})` },
        active: true,
      })
      .where(eq(schema.convChannels.id, channelId));
    return { ok: true, detail: 'credentials saved' };
  }
}

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
  let probeResult: { smtp: string; imap: string };
  let fakeProvider: FakeSmsProvider;
  let adminSvc: ChannelAdminService;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_KEY_PEPPER ??= 'integration-test-pepper';
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = '1';
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
    const probe: EmailChannelTester = {
      test: () => Promise.resolve(probeResult),
    };
    fakeProvider = new FakeSmsProvider();
    adminSvc = new ChannelAdminService([fakeProvider]);
    channels = new ChannelCredentialService(email, handoff, probe, db, adminSvc);
    targets.register(channels);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    probeResult = { smtp: 'ok', imap: 'ok' };
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
        active: false,
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
    expect(result.detail).toBe('SMTP ok; IMAP ok');

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.select().from(schema.convChannels).where(sql`id = ${channelId}`);
    const config = rows[0]!.config as {
      outbound: { encryptedPassword: string };
      inbound: { encryptedPassword: string };
    };
    expect(rows[0]!.active).toBe(true);
    expect(config.outbound.encryptedPassword.length).toBeGreaterThan(0);
    expect(config.inbound.encryptedPassword.length).toBeGreaterThan(0);
    expect(JSON.stringify(config)).not.toContain('smtp_secret_pw');
    expect(JSON.stringify(config)).not.toContain('imap_secret_pw');

    await expect(
      handoff.complete(token, { smtpPassword: 'again' }),
    ).rejects.toThrow(/invalid or expired/);
  });

  it('surfaces a failed verification probe without losing the saved credentials', async () => {
    probeResult = { smtp: 'error: EAUTH 535 bad credentials', imap: 'ok' };
    const link = await asAdmin(() => channels.requestLink(channelId));
    const result = await handoff.complete(tokenFromUrl(link.url), {
      smtpPassword: 'wrong_pw',
      imapPassword: 'imap_pw',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('EAUTH');

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.select().from(schema.convChannels).where(sql`id = ${channelId}`);
    const config = rows[0]!.config as { outbound: { encryptedPassword: string } };
    expect(config.outbound.encryptedPassword.length).toBeGreaterThan(0);
  });

  it('does not activate the channel while a required password is still missing', async () => {
    const link = await asAdmin(() => channels.requestLink(channelId));
    await handoff.complete(tokenFromUrl(link.url), { smtpPassword: 'smtp_only' });

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.select().from(schema.convChannels).where(sql`id = ${channelId}`);
    expect(rows[0]!.active).toBe(false);
  });

  it('rejects passwords passed through the setup tool path', async () => {
    const email = new EmailService();
    await expect(
      asAdmin(() =>
        email.createChannel(
          {
            name: 'Chat inbox',
            config: {
              addressing: { fromAddress: 'chat@acme.test' },
              outbound: {
                provider: 'smtp',
                host: 'smtp.acme.test',
                port: 587,
                secure: false,
                username: 'chat@acme.test',
                password: 'plaintext_pw',
              },
            },
          },
          { rejectSecrets: true },
        ),
      ),
    ).rejects.toThrow(/conv_invalid: secret fields \(outbound\.password\)/);
  });

  it('creates a secretless smtp channel inactive, and a mailer channel active', async () => {
    const email = new EmailService();
    const smtp = await asAdmin(() =>
      email.createChannel(
        {
          name: 'Pending inbox',
          config: {
            addressing: { fromAddress: 'pending@acme.test' },
            outbound: {
              provider: 'smtp',
              host: 'smtp.acme.test',
              port: 587,
              secure: false,
              username: 'pending@acme.test',
            },
          },
        },
        { rejectSecrets: true },
      ),
    );
    expect(smtp.active).toBe(false);

    const mailer = await asAdmin(() =>
      email.createChannel(
        {
          name: 'Mailer inbox',
          config: {
            addressing: { fromAddress: 'mailer@acme.test' },
            outbound: { provider: 'mailer' },
          },
        },
        { rejectSecrets: true },
      ),
    );
    expect(mailer.active).toBe(true);
  });

  it('refuses a credential link for a vendor without deferred-setup support', async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [sms] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'sms', vendor: 'nolink', name: 'SMS', config: {} })
      .returning();
    await expect(asAdmin(() => channels.requestLink(sms!.id))).rejects.toThrow(
      /credential links are not available/,
    );
  });

  describe('voice/SMS vendor flow (fake provider)', () => {
    it('rejects secret fields at the tool boundary', async () => {
      await expect(
        asAdmin(() =>
          adminSvc.configure(
            { vendor: 'fakesms', name: 'Leaky', config: { sender: 'ACME', apiToken: 'tok_leak' } },
            { rejectSecrets: true },
          ),
        ),
      ).rejects.toThrow(/conv_invalid: secret fields \(apiToken\)/);
    });

    it('rejects a pending create missing required non-secret config', async () => {
      await expect(
        asAdmin(() =>
          adminSvc.configure(
            { vendor: 'fakesms', name: 'No sender', config: {} },
            { rejectSecrets: true },
          ),
        ),
      ).rejects.toThrow(/sender/);
    });

    it('creates a pending channel, blocks admin actions, then completes setup via the link', async () => {
      const created = await asAdmin(() =>
        adminSvc.configure(
          { vendor: 'fakesms', name: 'Fake SMS line', config: { sender: 'ACME' } },
          { rejectSecrets: true },
        ),
      );
      expect(created.active).toBe(false);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const pendingRows = await db
        .select()
        .from(schema.convChannels)
        .where(sql`id = ${created.id}`);
      expect(pendingRows[0]!.config).toEqual({ [PENDING_SETUP_KEY]: { sender: 'ACME' } });

      await expect(asAdmin(() => adminSvc.test(created.id))).rejects.toThrow(
        /awaiting credentials/,
      );

      const link = await asAdmin(() => channels.requestLink(created.id));
      const token = tokenFromUrl(link.url);

      const described = await handoff.describe(token);
      expect(described.vendor).toBe('fakesms');
      expect(described.fields).toEqual([{ key: 'apiToken', label: 'apiToken', required: true }]);

      const result = await handoff.complete(token, { apiToken: 'tok_secret' });
      expect(result).toEqual({ ok: true, detail: 'credentials saved and verified' });

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db.select().from(schema.convChannels).where(sql`id = ${created.id}`);
      expect(rows[0]!.active).toBe(true);
      expect(rows[0]!.config).toEqual({ sender: 'ACME', encryptedApiToken: 'enc(tok_secret)' });
    });

    it('completes a pending vendor channel from the dashboard, with no link involved', async () => {
      const created = await asAdmin(() =>
        adminSvc.configure(
          { vendor: 'fakesms', name: 'Dashboard line', config: { sender: 'ACME' } },
          { rejectSecrets: true },
        ),
      );

      const applied = await asAdmin(() => channels.apply(created.id, { apiToken: 'tok_dash' }));
      expect(applied.ok).toBe(true);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db.select().from(schema.convChannels).where(sql`id = ${created.id}`);
      expect(rows[0]!.active).toBe(true);
      expect(rows[0]!.config).toEqual({ sender: 'ACME', encryptedApiToken: 'enc(tok_dash)' });
    });

    it('surfaces a failed vendor verification without dropping the saved credentials', async () => {
      fakeProvider.testResult = { ok: false, error: 'vendor rejected the token' };
      const created = await asAdmin(() =>
        adminSvc.configure(
          { vendor: 'fakesms', name: 'Bad token line', config: { sender: 'ACME' } },
          { rejectSecrets: true },
        ),
      );
      const link = await asAdmin(() => channels.requestLink(created.id));
      const result = await handoff.complete(tokenFromUrl(link.url), { apiToken: 'tok_bad' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('vendor rejected');

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db.select().from(schema.convChannels).where(sql`id = ${created.id}`);
      expect(rows[0]!.config).toEqual({ sender: 'ACME', encryptedApiToken: 'enc(tok_bad)' });
      fakeProvider.testResult = { ok: true };
    });
  });
});
