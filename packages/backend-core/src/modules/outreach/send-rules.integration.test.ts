import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  StubMailer,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { OutreachService } from './outreach.service.ts';
import { OutreachSendRulesService } from './send-rules.ts';
import { checkSendPolicy } from './send-policy.ts';
import { CrmService } from '../crm/crm.service.ts';
import { AddressDeliverabilityService } from '../crm/address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';
import { ConvService } from '../conv/conv.service.ts';
import { ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { EmailService } from '../conv/email/email.service.ts';
import { stubAttachmentGateway } from '../conv/attachments/conv-attachments.test-stub.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run send rules tests.';

function hhmm(at: Date): string {
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}

function quietAroundNow(): string {
  const now = Date.now();
  return `${hhmm(new Date(now - 60 * 60_000))}-${hhmm(new Date(now + 120 * 60_000))}`;
}

(skipReason ? describe.skip : describe)('Org send rules', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let outreach: OutreachService;
  let conv: ConvService;
  let rules: OutreachSendRulesService;
  let orgId: string;
  let userId: string;
  let agent: ActorIdentity;
  let person: ActorIdentity;
  let campaignId: string;
  let channelId: string;

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
      .values({ email: `operator-${randomUUID()}@acme.test`, name: 'Kari Nordmann' })
      .returning();
    userId = user!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId, role: 'owner' });
    agent = new ActorIdentity('admin_agent', 'agt_send_rules_test', orgId, ['*'], ['admin']);
    person = new ActorIdentity('user', userId, orgId, ['*'], ['admin'], undefined, undefined, undefined, userId);

    const webhooks = new WebhookDispatcher();
    const crm = new CrmService(webhooks, new DefaultQuotasService(), new AddressDeliverabilityService());
    conv = new ConvService(
      webhooks,
      new ConversationClaimsService(webhooks),
      new CuratorJobsService(webhooks),
      new AlertsService(webhooks),
      stubAttachmentGateway(),
    );
    outreach = new OutreachService(webhooks, conv, crm, new EmailService(new StubMailer()), [], appDb, new CuratorJobsService(webhooks));
    rules = new OutreachSendRulesService();
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await cleanup();
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  async function cleanup() {
    for (const table of [
      'conv_message_deliveries',
      'conv_messages',
      'conv_conversations',
      'conv_contacts',
      'outreach_proposals',
      'outreach_campaigns',
      'crm_contacts',
      'crm_segments',
      'conv_channels',
      'curator_jobs',
    ]) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
    await db.execute(sql`UPDATE orgs SET settings = '{}'::jsonb WHERE id = ${orgId}`);
  }

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await cleanup();
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({ orgId, name: 'all', filterDefinition: {}, createdByActorType: 'user', createdByActorId: userId })
      .returning();
    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'mail',
        active: true,
        config: { addressing: { fromAddress: 'hei@acme.test', fromName: 'Acme' } },
      })
      .returning();
    channelId = channel!.id;
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'Prospects',
        brief: 'Introduce Acme',
        segmentId: segment!.id,
        channelId,
        enabled: true,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_send_rules_test',
      })
      .returning();
    campaignId = campaign!.id;
  });

  function runAs<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }
  const asAgent = <T>(fn: () => Promise<T>) => runAs(agent, fn);
  const asPerson = <T>(fn: () => Promise<T>) => runAs(person, fn);

  async function contact(values: Partial<typeof schema.crmContacts.$inferInsert> = {}) {
    const [row] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Ola Nordmann', email: `ola-${randomUUID()}@kunde.test`, consentLawfulBasis: 'contract', ...values })
      .returning();
    return row!;
  }

  const setRules = (value: Partial<Parameters<OutreachSendRulesService['configure']>[0]> = {}) =>
    asAgent(() =>
      rules.configure({
        timezone: 'UTC',
        quietHours: null,
        validDays: null,
        weeklyCap: null,
        cooldownHoursAfterConversation: 0,
        ...value,
      }),
    );

  it('applies no send rules until the org sets them, and stores what it sets', async () => {
    await expect(asAgent(() => rules.get())).resolves.toMatchObject({
      configured: false,
      quietHours: null,
      weeklyCap: null,
      recommended: { quietHours: '20:00-08:00', weeklyCap: 3, cooldownHoursAfterConversation: 24 },
    });
    await setRules({ timezone: 'Europe/Oslo', quietHours: '21:00-07:30', validDays: ['mon', 'fri', 'mon'], weeklyCap: 2 });
    await expect(asAgent(() => rules.get())).resolves.toMatchObject({
      configured: true,
      timezone: 'Europe/Oslo',
      quietHours: '21:00-07:30',
      validDays: ['mon', 'fri'],
      weeklyCap: 2,
    });
    await expect(setRules({ timezone: 'Mars/Olympus_Mons' })).rejects.toThrow(BadRequestException);
  });

  it('holds a first touch approved in quiet hours until the window opens', async () => {
    const quiet = quietAroundNow();
    await setRules({ quietHours: quiet });
    const ola = await contact();
    const proposal = await asAgent(() =>
      outreach.proposeInitial({ campaignId, contactId: ola.id, draftSubject: 'Hei', draftBody: 'Hei Ola!' }),
    );
    const approved = await asPerson(() =>
      outreach.approveProposal(proposal.id, { fingerprint: proposal.draftFingerprint, publicBaseUrl: 'https://api.acme.test' }),
    );
    expect(approved.status).toBe('approved');
    const [h, m] = quiet.split('-')[1]!.split(':').map(Number);
    const opens = new Date();
    opens.setUTCHours(h!, m, 0, 0);
    if (opens.getTime() < Date.now()) opens.setUTCDate(opens.getUTCDate() + 1);
    const delay = new Date(approved.scheduledSendAt ?? 0).getTime() - opens.getTime();
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(15 * 60_000);
  });

  it('lets a reply to the contact through during quiet hours', async () => {
    await setRules({ quietHours: quietAroundNow(), weeklyCap: 1, cooldownHoursAfterConversation: 72 });
    const ola = await contact();
    const [convContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: ola.email, name: ola.name })
      .returning();
    const thread = await asAgent(() =>
      conv.createConversation({
        channelId,
        body: 'Hei Ola!',
        subject: 'Hei',
        contactId: convContact!.id,
        authorType: 'agent',
        authorId: agent.id,
        outreachCampaignId: campaignId,
        agentMode: 'draft_only',
      }),
    );
    await asAgent(() =>
      conv.sendMessage({ conversationId: thread.id, body: 'Hva koster det?', authorType: 'end_user', authorId: 'eu_test' }),
    );
    const reply = await asAgent(() => outreach.proposeReply({ conversationId: thread.id, draftBody: 'Det koster 99 kr.' }));
    const sent = await asPerson(() =>
      outreach.approveProposal(reply.id, { fingerprint: reply.draftFingerprint, publicBaseUrl: 'https://api.acme.test' }),
    );
    expect(sent.status).toBe('sent');
  });

  it('counts only marketing sends towards the weekly cap', async () => {
    await setRules({ weeklyCap: 2 });
    const ola = await contact();
    const sentProposal = (kind: 'initial' | 'journey', cls?: 'marketing' | 'transactional') => ({
      orgId,
      campaignId,
      contactId: ola.id,
      kind,
      draftBody: 'Hei',
      status: 'sent',
      sentAt: new Date(Date.now() - 60 * 60_000),
      evidence: cls ? { journeyMessage: { policy: { class: cls } } } : {},
      proposedByActorType: 'admin_agent',
      proposedByActorId: 'agt_send_rules_test',
    });
    await db.insert(schema.outreachProposals).values([
      sentProposal('initial'),
      sentProposal('journey', 'transactional'),
      sentProposal('journey', 'transactional'),
    ]);
    const marketing = { channel: 'email' as const, class: 'marketing' as const, cooldownHoursAfterConversation: 0 };
    await expect(asAgent(() => checkSendPolicy({ contactId: ola.id, policy: marketing }))).resolves.toEqual({ decision: 'send' });
    await db.insert(schema.outreachProposals).values(sentProposal('journey', 'marketing'));
    await expect(asAgent(() => checkSendPolicy({ contactId: ola.id, policy: marketing }))).resolves.toMatchObject({
      decision: 'defer',
      reason: 'frequency_cap',
    });
    await expect(
      asAgent(() => checkSendPolicy({ contactId: ola.id, policy: { ...marketing, class: 'transactional' } })),
    ).resolves.toEqual({ decision: 'send' });
  });

  it('only lets a journey or campaign make the org rules stricter', async () => {
    await setRules({ quietHours: quietAroundNow(), weeklyCap: 5 });
    const ola = await contact();
    await expect(
      asAgent(() =>
        checkSendPolicy({ contactId: ola.id, policy: { channel: 'email', class: 'marketing', cooldownHoursAfterConversation: 0 } }),
      ),
    ).resolves.toMatchObject({ decision: 'defer', reason: 'quiet_hours' });
    await expect(
      asAgent(() =>
        checkSendPolicy({
          contactId: ola.id,
          policy: { channel: 'email', class: 'transactional', cooldownHoursAfterConversation: 0 },
        }),
      ),
    ).resolves.toEqual({ decision: 'send' });
    await setRules({ validDays: ['mon', 'tue'] });
    await expect(
      asAgent(() =>
        checkSendPolicy({
          contactId: ola.id,
          policy: { channel: 'email', class: 'marketing', validDays: ['sat'], cooldownHoursAfterConversation: 0 },
        }),
      ),
    ).resolves.toEqual({ decision: 'skip', reason: 'no_valid_days' });
  });
});
