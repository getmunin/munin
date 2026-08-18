import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ChannelReactivationService,
  type ChannelActivator,
  type EmailChannelTester,
} from './channel-reactivation.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run channel reactivation tests.';

function emailConfig(opts: { smtpPassword: string; imapPassword: string }) {
  return {
    addressing: { fromAddress: 'support@acme.test' },
    outbound: {
      provider: 'smtp',
      host: 'smtp.acme.test',
      port: 587,
      secure: true,
      username: 'support@acme.test',
      encryptedPassword: opts.smtpPassword,
    },
    inbound: {
      provider: 'imap',
      host: 'imap.acme.test',
      port: 993,
      secure: true,
      username: 'support@acme.test',
      encryptedPassword: opts.imapPassword,
    },
  };
}

(skipReason ? describe.skip : describe)('ChannelReactivationService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let adminActor: ActorIdentity;
  let service: ChannelReactivationService;
  let probeResult: { smtp: string; imap: string };
  let probeCalls: number;
  let activations: Array<{ channelId: string; active: boolean }>;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_KEY_PEPPER ??= 'integration-test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Reactivation Org' }).returning();
    orgId = org!.id;
    adminActor = new ActorIdentity('admin_agent', 'agt_re', orgId, ['*'], ['admin']);

    const probe: EmailChannelTester = {
      test: () => {
        probeCalls += 1;
        return Promise.resolve(probeResult);
      },
    };
    const activator: ChannelActivator = {
      setChannelActive: async (channelId, active) => {
        activations.push({ channelId, active });
        await db
          .update(schema.convChannels)
          .set({ active })
          .where(sql`id = ${channelId}`);
        return { active };
      },
    };
    service = new ChannelReactivationService(probe, activator);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    probeResult = { smtp: 'ok', imap: 'ok' };
    probeCalls = 0;
    activations = [];
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.delete(schema.convChannels).where(sql`org_id = ${orgId}`);
  });

  async function seedChannel(overrides: {
    active?: boolean;
    type?: string;
    config?: Record<string, unknown>;
  }): Promise<string> {
    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: overrides.type ?? 'email',
        vendor: 'smtp',
        name: 'Support inbox',
        active: overrides.active ?? false,
        config:
          overrides.config ?? emailConfig({ smtpPassword: 'enc-smtp', imapPassword: 'enc-imap' }),
      })
      .returning();
    return channel!.id;
  }

  function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: adminActor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  it('activates a deactivated channel when SMTP and IMAP both connect', async () => {
    const channelId = await seedChannel({ active: false });

    const result = await asAdmin(() => service.reactivateIfHealthy(channelId));

    expect(result).toEqual({ active: true, probe: { smtp: 'ok', imap: 'ok' } });
    expect(activations).toEqual([{ channelId, active: true }]);
  });

  it('leaves the channel deactivated and reports the probe errors when IMAP still fails', async () => {
    const channelId = await seedChannel({ active: false });
    probeResult = { smtp: 'ok', imap: 'error: authentication failed' };

    const result = await asAdmin(() => service.reactivateIfHealthy(channelId));

    expect(result.active).toBe(false);
    expect(result.probe).toEqual({ smtp: 'ok', imap: 'error: authentication failed' });
    expect(activations).toEqual([]);
    const rows = await db.select().from(schema.convChannels).where(sql`id = ${channelId}`);
    expect(rows[0]!.active).toBe(false);
  });

  it('reports a probe that throws as a connection failure instead of propagating', async () => {
    const channelId = await seedChannel({ active: false });
    const throwingProbe: EmailChannelTester = {
      test: () => Promise.reject(new Error('getaddrinfo ENOTFOUND imap.acme.test')),
    };
    const throwingService = new ChannelReactivationService(throwingProbe, {
      setChannelActive: (channelIdArg, active) => {
        activations.push({ channelId: channelIdArg, active });
        return Promise.resolve({ active });
      },
    });

    const result = await asAdmin(() => throwingService.reactivateIfHealthy(channelId));

    expect(result.active).toBe(false);
    expect(result.probe?.imap).toContain('ENOTFOUND');
    expect(activations).toEqual([]);
  });

  it('does not probe a channel that is still awaiting credentials', async () => {
    const channelId = await seedChannel({
      active: false,
      config: emailConfig({ smtpPassword: '', imapPassword: '' }),
    });

    const result = await asAdmin(() => service.reactivateIfHealthy(channelId));

    expect(result).toEqual({ active: false });
    expect(probeCalls).toBe(0);
    expect(activations).toEqual([]);
  });

  it('does not probe a channel that is already active', async () => {
    const channelId = await seedChannel({ active: true });

    const result = await asAdmin(() => service.reactivateIfHealthy(channelId));

    expect(result).toEqual({ active: true });
    expect(probeCalls).toBe(0);
    expect(activations).toEqual([]);
  });

  it('ignores non-email channels', async () => {
    const channelId = await seedChannel({
      active: false,
      type: 'sms',
      config: { sender: '+4712345678' },
    });

    const result = await asAdmin(() => service.reactivateIfHealthy(channelId));

    expect(result).toEqual({ active: false });
    expect(probeCalls).toBe(0);
  });
});
