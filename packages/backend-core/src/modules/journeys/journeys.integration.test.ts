import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JourneysService } from './journeys.service.ts';
import { JourneyTemplatesService } from './journey-templates.service.ts';
import { OutreachService } from '../outreach/outreach.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { AddressDeliverabilityService } from '../crm/address-deliverability.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run journeys tests.';

(skipReason ? describe.skip : describe)('JourneysService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: JourneysService;
  let crm: CrmService;
  let orgId: string;
  let otherOrgId: string;
  let agent: ActorIdentity;
  let outsider: ActorIdentity;
  let emailCampaignId: string;
  let emailChannelId: string;
  let smsChannelId: string;
  let outreach: OutreachService;
  let smsCampaignId: string;
  let segmentId: string;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    const [other] = await db.insert(schema.orgs).values({ name: 'Other' }).returning();
    otherOrgId = other!.id;
    agent = new ActorIdentity('admin_agent', 'agt_journeys_test', orgId, ['*'], ['admin']);
    outsider = new ActorIdentity('admin_agent', 'agt_outsider', otherOrgId, ['*'], ['admin']);
    const webhooks = new WebhookDispatcher();
    crm = new CrmService(webhooks, new DefaultQuotasService(), new AddressDeliverabilityService());
    outreach = new OutreachService(webhooks, {} as never, crm, {} as never, [], appDb, {} as never);
    svc = new JourneysService(webhooks, null, outreach);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      for (const table of ['journey_templates', 'journey_versions', 'journeys', 'outreach_campaigns', 'crm_segments', 'conv_channels']) {
        await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id IN (${orgId}, ${otherOrgId})`);
      }
      await db.delete(schema.orgs).where(sql`id IN (${orgId}, ${otherOrgId})`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    for (const table of ['journey_templates', 'journey_versions', 'journeys', 'outreach_campaigns', 'crm_segments', 'conv_channels', 'events']) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({ orgId, name: 'trialists', filterDefinition: {}, createdByActorType: 'user', createdByActorId: 'usr_1' })
      .returning();
    segmentId = segment!.id;
    emailCampaignId = await campaign('email', 'Trial onboarding');
    smsCampaignId = await campaign('sms', 'Trial SMS');
  });

  async function campaign(type: 'email' | 'sms', name: string): Promise<string> {
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type, vendor: type === 'email' ? 'smtp' : 'twilio', name, active: true, config: {} })
      .returning();
    if (type === 'email') emailChannelId = channel!.id;
    else smsChannelId = channel!.id;
    const [row] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name,
        brief: 'Help trial users get value in their first week.',
        segmentId,
        channelId: channel!.id,
        createdByActorType: 'admin_agent',
        createdByActorId: 'agt_journeys_test',
      })
      .returning();
    return row!.id;
  }

  function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${as.orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: as, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }
  const asAgent = <T>(fn: () => Promise<T>) => runAs(agent, fn);

  const validSpec = () => ({
    entry: { trigger: { type: 'event', event: 'trial.started' }, segmentId },
    goal: { event: 'subscription.started', windowDays: 30 },
    start: 'welcome',
    nodes: [
      { id: 'welcome', type: 'message', channel: 'email', content: { subject: 'Velkommen', body: 'Hei!' }, next: 'done' },
      { id: 'done', type: 'exit' },
    ],
  });

  it('creates a journey on an email campaign with draft version 1 and emits journey.created', async () => {
    const journey = await asAgent(() => svc.create({ name: 'Trial onboarding', outreachCampaignId: emailCampaignId }));
    expect(journey).toMatchObject({ status: 'draft', draftVersion: 1, liveVersion: null, live: null });
    expect(journey.draft?.spec).toMatchObject({ start: 'done' });
    const [event] = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'journey.created')));
    expect(event?.payload).toMatchObject({ journeyId: journey.id });
  });

  it('refuses non-email campaigns and a second journey on the same campaign', async () => {
    await expect(asAgent(() => svc.create({ name: 'SMS', outreachCampaignId: smsCampaignId }))).rejects.toThrow(
      BadRequestException,
    );
    await asAgent(() => svc.create({ name: 'First', outreachCampaignId: emailCampaignId }));
    await expect(asAgent(() => svc.create({ name: 'Second', outreachCampaignId: emailCampaignId }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('lets a new journey take over a campaign once the journey running it is archived', async () => {
    const first = await asAgent(() => svc.create({ name: 'First', outreachCampaignId: emailCampaignId }));
    await asAgent(() => svc.archive(first.id));
    const second = await asAgent(() => svc.create({ name: 'Second', outreachCampaignId: emailCampaignId }));
    expect(second.outreachCampaignId).toBe(emailCampaignId);
  });

  it('creates the campaign a journey sends through from its email channel, and keeps outreach from reconfiguring it', async () => {
    const journey = await asAgent(() => svc.create({ name: 'Welcome', senderChannelId: emailChannelId }));
    const campaign = await asAgent(() => outreach.getCampaign(journey.outreachCampaignId));
    expect(campaign).toMatchObject({
      name: 'Welcome (journey)',
      segmentId: null,
      channelId: emailChannelId,
      enabled: false,
      autoDraftFirstTouch: false,
      autoDraftReplies: false,
      journeyId: journey.id,
    });
    await expect(asAgent(() => outreach.updateCampaign({ id: campaign.id, patch: { enabled: true } }))).rejects.toThrow(
      /outreach_journey_managed/,
    );
    await expect(
      asAgent(() => outreach.updateCampaign({ id: campaign.id, patch: { channelId: smsChannelId } })),
    ).rejects.toThrow(/outreach_journey_managed/);
    await expect(
      asAgent(() => outreach.updateCampaign({ id: campaign.id, patch: { name: 'Welcome mail' } })),
    ).resolves.toMatchObject({ name: 'Welcome mail', journeyId: journey.id });

    const [backup] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'Backup mail', active: true, config: {} })
      .returning();
    await db.update(schema.journeys).set({ status: 'live' }).where(eq(schema.journeys.id, journey.id));
    await expect(
      asAgent(() => outreach.updateCampaign({ id: campaign.id, patch: { channelId: backup!.id } })),
    ).rejects.toThrow(/pause the journey/);
    await db.update(schema.journeys).set({ status: 'paused' }).where(eq(schema.journeys.id, journey.id));
    await expect(
      asAgent(() => outreach.updateCampaign({ id: campaign.id, patch: { channelId: backup!.id } })),
    ).resolves.toMatchObject({ channelId: backup!.id });
  });

  it('refuses a sending channel that is not email, and a campaign name already in use', async () => {
    await expect(asAgent(() => svc.create({ name: 'Texts', senderChannelId: smsChannelId }))).rejects.toThrow(
      BadRequestException,
    );
    await campaign('email', 'Taken (journey)');
    await expect(asAgent(() => svc.create({ name: 'Taken', senderChannelId: emailChannelId }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('edits the open draft node by node and validates it against org references', async () => {
    const journey = await asAgent(() => svc.create({ name: 'Trial onboarding', outreachCampaignId: emailCampaignId }));
    await asAgent(() => svc.updateSettings(journey.id, { entry: validSpec().entry, goal: validSpec().goal, start: 'welcome' }));
    await asAgent(() =>
      svc.addNode(journey.id, { id: 'welcome', type: 'message', channel: 'email', content: { subject: 'Hei', body: 'Hei!' } }),
    );
    let validation = await asAgent(() => svc.validate(journey.id));
    expect(validation.errors.map((e) => e.code)).toEqual(['unreachable_node']);
    expect(validation.warnings.map((w) => w.code)).toContain('implicit_end');

    await asAgent(() =>
      svc.updateNode(journey.id, { id: 'welcome', type: 'message', channel: 'email', content: { subject: 'Hei', body: 'Hei!' }, next: 'done' }),
    );
    validation = await asAgent(() => svc.validate(journey.id));
    expect(validation.errors).toEqual([]);

    await asAgent(() =>
      svc.updateNode(journey.id, { id: 'welcome', type: 'message', channel: 'email', content: { subject: 'Hei', body: 'Hei!' }, next: 'gone' }),
    );
    validation = await asAgent(() => svc.validate(journey.id));
    expect(validation.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['dangling_edge', 'unreachable_node']));

    const versions = await asAgent(() => svc.listVersions(journey.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.validation?.valid).toBe(false);
    expect(versions[0]!.changeSummary).toContain('Updated node welcome');
  });

  it('refuses a node that does not fit its type, whichever surface sends it', async () => {
    const journey = await asAgent(() => svc.create({ name: `Shape ${randomUUID()}`, outreachCampaignId: emailCampaignId }));
    await expect(asAgent(() => svc.addNode(journey.id, { id: 'wait', type: 'wait', duration: 'five days' }))).rejects.toThrow(
      /journeys_invalid: duration/,
    );
    await asAgent(() => svc.addNode(journey.id, { id: 'wait', type: 'wait', duration: 'P5D' }));
    await expect(asAgent(() => svc.updateNode(journey.id, { id: 'wait', type: 'wait', duration: 5 }))).rejects.toThrow(/journeys_invalid/);
  });

  it('refuses an edit made against a draft that changed since it was loaded, with codes the dashboard can translate', async () => {
    const journey = await asAgent(() =>
      svc.create({ name: 'Trial onboarding', outreachCampaignId: emailCampaignId, spec: validSpec() }),
    );
    const [loaded] = await asAgent(() => svc.listVersions(journey.id));
    const node = { id: 'welcome', type: 'message', channel: 'email', content: { subject: 'Hei igjen', body: 'Hei!' }, next: 'done' };
    const edited = await asAgent(() => svc.updateNode(journey.id, node, { ifSpecHash: loaded!.specHash }));
    expect(edited.specHash).not.toBe(loaded!.specHash);

    const stale = asAgent(() => svc.removeNode(journey.id, 'welcome', { ifSpecHash: loaded!.specHash }));
    await expect(stale).rejects.toThrow(ConflictException);
    await expect(stale).rejects.toMatchObject({ response: { code: 'journeys_draft_changed' } });
    const duplicate = asAgent(() => svc.addNode(journey.id, node, undefined, { ifSpecHash: edited.specHash }));
    await expect(duplicate).rejects.toMatchObject({ response: { code: 'journeys_node_exists' } });

    const settled = await asAgent(() => svc.updateSettings(journey.id, { start: 'welcome' }, { ifSpecHash: edited.specHash }));
    expect(settled.changeSummary).toContain('Updated node welcome');
  });

  it('never changes a published version: edits open a new draft based on it', async () => {
    const journey = await asAgent(() =>
      svc.create({ name: 'Trial onboarding', outreachCampaignId: emailCampaignId, spec: validSpec() }),
    );
    await db
      .update(schema.journeyVersions)
      .set({ publishedAt: new Date(), publishedByActorId: 'usr_1' })
      .where(eq(schema.journeyVersions.journeyId, journey.id));
    await db.update(schema.journeys).set({ status: 'live', liveVersion: 1 }).where(eq(schema.journeys.id, journey.id));

    const draft = await asAgent(() => svc.removeNode(journey.id, 'welcome'));
    expect(draft).toMatchObject({ number: 2, parentVersion: 1, publishedAt: null });
    const v1 = await asAgent(() => svc.getVersion(journey.id, 1));
    expect((v1.spec.nodes as unknown[]).length).toBe(2);
    const detail = await asAgent(() => svc.get(journey.id));
    expect(detail).toMatchObject({ liveVersion: 1, draftVersion: 2 });

    const restored = await asAgent(() => svc.restoreVersion(journey.id, 1));
    expect(restored.number).toBe(2);
    expect(restored.specHash).toBe(v1.specHash);
  });

  it('moves through pause, resume and archive only from the allowed states', async () => {
    const journey = await asAgent(() => svc.create({ name: 'Trial onboarding', outreachCampaignId: emailCampaignId }));
    await expect(asAgent(() => svc.pause(journey.id))).rejects.toThrow(ConflictException);
    await db.update(schema.journeys).set({ status: 'live', liveVersion: 1 }).where(eq(schema.journeys.id, journey.id));
    expect((await asAgent(() => svc.pause(journey.id))).status).toBe('paused');
    expect((await asAgent(() => svc.resume(journey.id))).status).toBe('live');
    const archived = await asAgent(() => svc.archive(journey.id));
    expect(archived.archivedAt).not.toBeNull();
    await expect(asAgent(() => svc.removeNode(journey.id, 'done'))).rejects.toThrow(ConflictException);
    expect(await asAgent(() => svc.list())).toEqual([]);
    expect(await asAgent(() => svc.list({ status: 'archived' }))).toHaveLength(1);
  });

  it('blocks deleting a segment that a journey spec uses, until the journey is archived', async () => {
    const [entrySegment] = await db
      .insert(schema.crmSegments)
      .values({ orgId, name: 'journey entry', filterDefinition: {}, createdByActorType: 'user', createdByActorId: 'usr_1' })
      .returning();
    const spec = { ...validSpec(), entry: { ...validSpec().entry, segmentId: entrySegment!.id } };
    const journey = await asAgent(() =>
      svc.create({ name: 'Trial onboarding', outreachCampaignId: emailCampaignId, spec }),
    );
    await expect(asAgent(() => crm.deleteSegment(entrySegment!.id))).rejects.toThrow(/journey/);
    await asAgent(() => svc.archive(journey.id));
    await expect(asAgent(() => crm.deleteSegment(entrySegment!.id))).resolves.toEqual({ deleted: true });
  });

  it('creates a journey from a template and saves a journey back as a parameterised template', async () => {
    const templates = new JourneyTemplatesService(svc);
    const listed = await asAgent(() => templates.list('nb'));
    expect(listed.map((t) => t.slug)).toContain('trial-onboarding');
    await expect(
      asAgent(() =>
        templates.instantiate({ slug: 'trial-onboarding', locale: 'nb', name: 'Prøve', senderChannelId: emailChannelId, params: {} }),
      ),
    ).rejects.toThrow(BadRequestException);
    const created = await asAgent(() =>
      templates.instantiate({
        slug: 'trial-onboarding',
        locale: 'nb',
        name: 'Prøve',
        senderChannelId: emailChannelId,
        params: { segmentId },
      }),
    );
    expect(created.validation.errors).toEqual([]);
    expect(created.draft?.spec).toMatchObject({ entry: { segmentId } });

    const saved = await asAgent(() =>
      templates.saveAsTemplate({
        journeyId: created.id,
        slug: 'our-trial',
        locale: 'nb',
        title: 'Vår prøveperiode',
        description: 'Tilpasset utgave',
        params: [{ key: 'segmentId', description: 'Segment', required: true }],
        replace: { [segmentId]: 'segmentId' },
      }),
    );
    expect(saved).toMatchObject({ slug: 'our-trial', builtIn: false });
    const own = await asAgent(() => templates.get('our-trial', 'nb'));
    expect(JSON.stringify(own.spec)).toContain('{{param:segmentId}}');
    expect(JSON.stringify(own.spec)).not.toContain(segmentId);
    const untouched = await asAgent(() =>
      templates.saveAsTemplate({
        journeyId: created.id,
        slug: 'our-trial-copy',
        locale: 'nb',
        title: 'Kopi',
        description: 'Kopi',
        params: [{ key: 'days', description: 'Dager', required: false }],
        replace: { '30': 'days', next: 'days' },
      }),
    );
    expect(untouched.slug).toBe('our-trial-copy');
    const copy = await asAgent(() => templates.get('our-trial-copy', 'nb'));
    expect(JSON.stringify(copy.spec)).not.toContain('{{param:days}}');
    await expect(
      asAgent(() =>
        templates.saveAsTemplate({ journeyId: created.id, slug: 'trial-onboarding', locale: 'nb', title: 'x', description: 'x' }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('converts a campaign sequence into a draft journey that takes the campaign over once published', async () => {
    await db
      .update(schema.outreachCampaigns)
      .set({ sequenceSteps: [{ waitDays: 4, brief: 'Follow up with the case study' }] })
      .where(eq(schema.outreachCampaigns.id, emailCampaignId));
    const templates = new JourneyTemplatesService(svc);
    const created = await asAgent(() =>
      templates.createFromCampaign({ campaignId: emailCampaignId, goal: { event: 'deal.won', windowDays: 60 } }),
    );
    expect(created.validation.errors).toEqual([]);
    expect(created.notes.length).toBeGreaterThan(0);
    expect((created.draft?.spec as { nodes: { id: string }[] }).nodes.map((n) => n.id)).toEqual([
      'first_touch',
      'wait_1',
      'followup_1',
      'replied',
      'done',
    ]);
    await expect(
      asAgent(() => templates.createFromCampaign({ campaignId: emailCampaignId, goal: { event: 'deal.won', windowDays: 60 } })),
    ).rejects.toThrow(ConflictException);
  });

  it('warns that agent steps fall back when the org has no model, and tells when an outreach outcome lands', async () => {
    const withoutModel = new JourneysService(new WebhookDispatcher(), { providerConfigured: () => Promise.resolve(false) });
    const journey = await asAgent(() =>
      withoutModel.create({
        name: 'Agent triage',
        outreachCampaignId: emailCampaignId,
        spec: {
          ...validSpec(),
          start: 'triage',
          nodes: [
            {
              id: 'triage',
              type: 'agent',
              mode: 'decide',
              instructions: 'Likely to buy?',
              edges: { yes: 'done', no: 'done' },
              fallback: 'no',
              inputs: ['contact'],
            },
            { id: 'done', type: 'exit' },
          ],
        },
      }),
    );
    const validation = await asAgent(() => withoutModel.validate(journey.id));
    expect(validation.warnings.map((w) => w.code)).toContain('agent_without_model');
    expect((await asAgent(() => svc.validate(journey.id))).warnings.map((w) => w.code)).not.toContain('agent_without_model');

    const contact = await asAgent(() => crm.createContact({ name: 'Ola Nordmann', email: 'ola@kunde.test' }));
    await asAgent(() =>
      crm.updateContact({
        id: contact.id,
        patch: { customFields: { outreachOutcome: 'reached', outreachOutcomeConversationId: 'ccv_call', budget: 'Q1' } },
      }),
    );
    const [event] = await db
      .select({ payload: schema.events.payload })
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'outreach.outcome.recorded')));
    expect(event!.payload).toEqual({ contactId: contact.id, outcome: 'reached', conversationId: 'ccv_call', fields: ['budget'] });
    await asAgent(() =>
      crm.updateContact({
        id: contact.id,
        patch: { customFields: { outreachOutcome: 'reached', outreachOutcomeConversationId: 'ccv_call', budget: 'Q2' } },
      }),
    );
    const outcomes = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(and(eq(schema.events.orgId, orgId), eq(schema.events.type, 'outreach.outcome.recorded')));
    expect(outcomes).toHaveLength(1);
  });

  it('keeps journeys invisible to other organizations', async () => {
    const journey = await asAgent(() => svc.create({ name: 'Trial onboarding', outreachCampaignId: emailCampaignId }));
    await expect(runAs(outsider, () => svc.get(journey.id))).rejects.toThrow(NotFoundException);
    expect(await runAs(outsider, () => svc.list())).toEqual([]);
  });
});
