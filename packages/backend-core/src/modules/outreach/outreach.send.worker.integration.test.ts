import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { OutreachService } from './outreach.service.ts';
import { OutreachSendWorker } from './outreach.send.worker.ts';
import { CrmService } from '../crm/crm.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { ConvService } from '../conv/conv.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { VapiClientService } from '../conv/vapi/vapi-client.service.ts';
import { VapiOutreachCaller } from '../conv/vapi/vapi-outreach-caller.ts';
import { ThrellClientService } from '../conv/threll/threll-client.service.ts';
import { ThrellOutreachCaller } from '../conv/threll/threll-outreach-caller.ts';
import { ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { EmailService } from '../conv/email/email.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run outreach send worker tests.';

(skipReason ? describe.skip : describe)('OutreachSendWorker', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: OutreachService;
  let worker: OutreachSendWorker;
  let orgId: string;
  let approver: ActorIdentity;
  let segmentId: string;
  let channelId: string;
  let contactId: string;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_MAIL_PROVIDER ??= 'stub';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Send Worker Org' }).returning();
    orgId = org!.id;
    approver = new ActorIdentity(
      'user',
      'usr_send_worker_test',
      orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      'usr_send_worker_test',
    );

    const dispatcher = new WebhookDispatcher();
    const crm = new CrmService(dispatcher, new DefaultQuotasService());
    const claims = new ConversationClaimsService(dispatcher);
    const conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
    );
    svc = new OutreachService(
      dispatcher,
      conv,
      crm,
      new EmailService(),
      [new VapiOutreachCaller(new VapiClientService(db)), new ThrellOutreachCaller(new ThrellClientService(db))],
      appDb,
      new CuratorJobsService(dispatcher),
    );
    worker = new OutreachSendWorker(appDb, svc);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM outreach_proposals WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM outreach_campaigns WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_message_deliveries WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_activities WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_segments WHERE org_id = ${orgId}`);

    const [ch] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'support',
        active: true,
        config: { addressing: { fromAddress: 'support@example.com' } },
      })
      .returning();
    channelId = ch!.id;

    const [seg] = await db
      .insert(schema.crmSegments)
      .values({
        orgId,
        name: 'prospects',
        description: null,
        filterDefinition: {},
        createdByActorType: 'user',
        createdByActorId: approver.id,
      })
      .returning();
    segmentId = seg!.id;

    const [contact] = await db
      .insert(schema.crmContacts)
      .values({
        orgId,
        name: 'Jane Doe',
        email: 'jane@acme.com',
        consentLawfulBasis: 'legitimate_interest',
        consentGivenAt: new Date(),
        consentSource: 'imported-test',
      })
      .returning();
    contactId = contact!.id;
  });

  function runAsApprover<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: approver, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function scheduleFirstTouch(name: string, sendAt: Date) {
    const campaign = await runAsApprover(() =>
      svc.createCampaign({ name, brief: 'b', segmentId, channelId, enabled: true }),
    );
    const proposal = await runAsApprover(() =>
      svc.proposeInitial({
        campaignId: campaign.id,
        contactId,
        draftSubject: 'Hi Jane',
        draftBody: 'body',
      }),
    );
    const approved = await runAsApprover(() =>
      svc.approveProposal(proposal.id, {
        publicBaseUrl: 'https://test.local',
        fingerprint: proposal.draftFingerprint,
        sendAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    expect(approved.status).toBe('approved');
    await db
      .update(schema.outreachProposals)
      .set({ scheduledSendAt: sendAt })
      .where(eq(schema.outreachProposals.id, proposal.id));
    return proposal.id;
  }

  async function statusOf(id: string): Promise<string> {
    const rows = await db
      .select({ status: schema.outreachProposals.status })
      .from(schema.outreachProposals)
      .where(eq(schema.outreachProposals.id, id));
    return rows[0]!.status;
  }

  it('drains a due proposal as the unprivileged app role and sends it', async () => {
    const id = await scheduleFirstTouch('due-now', new Date(Date.now() - 60_000));

    const result = await worker.tick();

    expect(result).toEqual({ sent: 1, deferred: 0, failed: 0 });
    expect(await statusOf(id)).toBe('sent');

    const messages = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM conv_messages WHERE org_id = ${orgId}`,
    );
    expect(messages[0]!.count).toBe(1);
  });

  it('leaves a proposal whose time has not come alone', async () => {
    const id = await scheduleFirstTouch('due-later', new Date(Date.now() + 3_600_000));

    const result = await worker.tick();

    expect(result).toEqual({ sent: 0, deferred: 0, failed: 0 });
    expect(await statusOf(id)).toBe('approved');
  });

  it('fails a due proposal whose contact was suppressed while it waited', async () => {
    const id = await scheduleFirstTouch('due-suppressed', new Date(Date.now() - 60_000));
    await db
      .update(schema.crmContacts)
      .set({ doNotContact: true })
      .where(eq(schema.crmContacts.id, contactId));

    const result = await worker.tick();

    expect(result).toEqual({ sent: 0, deferred: 0, failed: 1 });
    expect(await statusOf(id)).toBe('failed');

    const rows = await db
      .select({
        failureReason: schema.outreachProposals.failureReason,
        sendAttempts: schema.outreachProposals.sendAttempts,
      })
      .from(schema.outreachProposals)
      .where(eq(schema.outreachProposals.id, id));
    expect(rows[0]!.failureReason).toMatch(/no longer eligible/);
    expect(rows[0]!.sendAttempts).toBe(1);

    const messages = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM conv_messages WHERE org_id = ${orgId}`,
    );
    expect(messages[0]!.count).toBe(0);
  });

  it('a canceled send is no longer drained', async () => {
    const id = await scheduleFirstTouch('due-canceled', new Date(Date.now() - 60_000));
    await runAsApprover(() => svc.cancelScheduledSend({ id, reason: 'changed my mind' }));

    const result = await worker.tick();

    expect(result).toEqual({ sent: 0, deferred: 0, failed: 0 });
    expect(await statusOf(id)).toBe('pending');
  });
});
