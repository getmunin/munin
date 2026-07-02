import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, WebhookDispatcher, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { CrmService, CrmInvalidError } from './crm.service.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CRM service tests.';

(skipReason ? describe.skip : describe)('CrmService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: CrmService;
  let orgId: string;
  let endUserId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'CRM Service Test Org' })
      .returning();
    orgId = org!.id;
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: `eu-${ts}`, name: 'Test End User' })
      .returning();
    endUserId = eu!.id;
    actor = new ActorIdentity('admin_agent', 'agt_crm_test', orgId, ['*'], ['admin']);

    svc = new CrmService(new WebhookDispatcher(), new DefaultQuotasService());
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM crm_merge_proposals WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_activities WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_deals WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_stages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_pipelines WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_companies WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = actor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      const ctx: RequestContext = {
        db: tx,
        actor: runAs,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  // ─── Contacts ────────────────────────────────────────────────────────

  describe('contacts', () => {
    it('createContact persists with the requested fields', async () => {
      const c = await run(() =>
        svc.createContact({
          name: 'Alice',
          email: 'alice@example.com',
          tags: ['vip'],
          customFields: { region: 'EU' },
        }),
      );
      expect(c.name).toBe('Alice');
      expect(c.email).toBe('alice@example.com');
      expect(c.tags).toEqual(['vip']);
      expect(c.customFields).toEqual({ region: 'EU' });
    });

    it('listContacts filters by tag and companyId', async () => {
      const co = await run(() => svc.createCompany({ name: 'Acme' }));
      await run(() => svc.createContact({ name: 'A', email: 'a@x', tags: ['lead'] }));
      await run(() => svc.createContact({ name: 'B', email: 'b@x', tags: ['vip'] }));
      await run(() =>
        svc.createContact({ name: 'C', email: 'c@x', companyId: co.id, tags: ['vip'] }),
      );
      const vips = await run(() => svc.listContacts({ tag: 'vip' }));
      expect(vips.map((c) => c.email).sort()).toEqual(['b@x', 'c@x']);
      const atAcme = await run(() => svc.listContacts({ companyId: co.id }));
      expect(atAcme).toHaveLength(1);
    });

    it('getContact 404s on unknown id', async () => {
      await expect(run(() => svc.getContact(randomUUID()))).rejects.toThrow(NotFoundException);
    });

    it('findContact returns the matching contact or null', async () => {
      await run(() => svc.createContact({ email: 'find@example.com' }));
      const hit = await run(() => svc.findContact({ email: 'find@example.com' }));
      expect(hit).not.toBeNull();
      expect(hit!.email).toBe('find@example.com');
      const miss = await run(() => svc.findContact({ email: 'nobody@example.com' }));
      expect(miss).toBeNull();
    });

    it('findContact rejects when neither email nor phone is provided', async () => {
      await expect(run(() => svc.findContact({}))).rejects.toThrow(CrmInvalidError);
    });

    it('getMyContact returns the contact bound to the actor end-user; 404 if none', async () => {
      const linkedActor = new ActorIdentity('end_user_agent', 'eu_agent', orgId, ['crm:read'], ['self_service'], endUserId);
      await expect(run(() => svc.getMyContact(), linkedActor)).rejects.toThrow(NotFoundException);
      await run(() => svc.createContact({ name: 'Me', endUserId }));
      const me = await run(() => svc.getMyContact(), linkedActor);
      expect(me.endUserId).toBe(endUserId);
    });

    it('getMyContact rejects when actor has no end-user identity', async () => {
      await expect(run(() => svc.getMyContact())).rejects.toThrow(CrmInvalidError);
    });

    it('updateContact patches arbitrary fields and 404s on unknown', async () => {
      const c = await run(() => svc.createContact({ name: 'A', email: 'a@x' }));
      const updated = await run(() =>
        svc.updateContact({ id: c.id, patch: { name: 'A2', tags: ['x'] } }),
      );
      expect(updated.name).toBe('A2');
      expect(updated.tags).toEqual(['x']);
      await expect(
        run(() => svc.updateContact({ id: randomUUID(), patch: { name: 'X' } })),
      ).rejects.toThrow(NotFoundException);
    });

    it('updateContact shallow-merges customFields with existing', async () => {
      const c = await run(() =>
        svc.createContact({ name: 'A', email: 'a@x', customFields: { region: 'EU', plan: 'pro' } }),
      );
      const updated = await run(() =>
        svc.updateContact({ id: c.id, patch: { customFields: { plan: 'enterprise' } } }),
      );
      expect(updated.customFields).toEqual({ region: 'EU', plan: 'enterprise' });
      const cleared = await run(() =>
        svc.updateContact({ id: c.id, patch: { customFields: { region: null } } }),
      );
      expect(cleared.customFields).toEqual({ region: null, plan: 'enterprise' });
    });

    it('updateContact toggling doNotContact stamps unsubscribedAt', async () => {
      const c = await run(() => svc.createContact({ name: 'A', email: 'a@x' }));
      const subscribed = await run(() =>
        svc.updateContact({ id: c.id, patch: { doNotContact: true } }),
      );
      expect(subscribed.doNotContact).toBe(true);
      expect(subscribed.unsubscribedAt).not.toBeNull();
      const resubbed = await run(() =>
        svc.updateContact({ id: c.id, patch: { doNotContact: false } }),
      );
      expect(resubbed.unsubscribedAt).toBeNull();
    });

    it('bulkCreateContacts creates new contacts and skips existing matches', async () => {
      await run(() => svc.createContact({ email: 'dup@x' }));
      const result = await run(() =>
        svc.bulkCreateContacts([
          { email: 'dup@x', name: 'Dup' },
          { email: 'fresh@x', name: 'Fresh' },
        ]),
      );
      expect(result).toEqual({ created: 1, skipped: 1 });
      const list = await run(() => svc.listContacts({}));
      expect(list.map((c) => c.email).sort()).toEqual(['dup@x', 'fresh@x']);
    });

    it('bulkCreateContacts caps at 500 rows per call', async () => {
      const huge = Array.from({ length: 501 }, (_, i) => ({ email: `big${i}@x` }));
      await expect(run(() => svc.bulkCreateContacts(huge))).rejects.toThrow(CrmInvalidError);
    });

    it('bulkCreateContacts is a no-op for empty input', async () => {
      const r = await run(() => svc.bulkCreateContacts([]));
      expect(r).toEqual({ created: 0, skipped: 0 });
    });

    it('setAiSummary updates contact / company / deal and 404s on unknown', async () => {
      const c = await run(() => svc.createContact({ name: 'A' }));
      const ok = await run(() =>
        svc.setAiSummary({ entityType: 'contact', id: c.id, summary: 's', nextAction: 'a' }),
      );
      expect(ok).toEqual({ ok: true });
      const refreshed = await run(() => svc.getContact(c.id));
      expect(refreshed.aiSummary).toBe('s');
      expect(refreshed.aiNextAction).toBe('a');
      await expect(
        run(() => svc.setAiSummary({ entityType: 'contact', id: randomUUID(), summary: 'x' })),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Companies ───────────────────────────────────────────────────────

  describe('companies', () => {
    it('createCompany persists fields', async () => {
      const co = await run(() =>
        svc.createCompany({ name: 'Acme', domain: 'acme.com', tags: ['enterprise'] }),
      );
      expect(co.name).toBe('Acme');
      expect(co.domain).toBe('acme.com');
      expect(co.tags).toEqual(['enterprise']);
    });

    it('listCompanies returns rows ordered by updatedAt desc', async () => {
      await run(() => svc.createCompany({ name: 'A' }));
      await run(() => svc.createCompany({ name: 'B' }));
      const list = await run(() => svc.listCompanies({}));
      expect(list.map((c) => c.name)).toEqual(['B', 'A']);
    });

    it('getCompany 404s on unknown id', async () => {
      await expect(run(() => svc.getCompany(randomUUID()))).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Pipelines & deals ───────────────────────────────────────────────

  describe('pipelines and deals', () => {
    async function seedPipeline() {
      return run(() =>
        svc.createPipeline({
          name: 'Sales',
          slug: 'sales',
          stages: [
            { name: 'Prospect' },
            { name: 'Qualified' },
            { name: 'Closed Won', winLoss: 'won' },
            { name: 'Closed Lost', winLoss: 'lost' },
          ],
        }),
      );
    }

    it('createPipeline persists pipeline and stages', async () => {
      const p = await seedPipeline();
      expect(p.slug).toBe('sales');
      expect(p.stages.map((s) => s.name)).toEqual([
        'Prospect',
        'Qualified',
        'Closed Won',
        'Closed Lost',
      ]);
    });

    it('createPipeline rejects empty stages and bad slug', async () => {
      await expect(
        run(() => svc.createPipeline({ name: 'X', slug: 'bad slug', stages: [{ name: 'A' }] })),
      ).rejects.toThrow(CrmInvalidError);
      await expect(
        run(() => svc.createPipeline({ name: 'X', slug: 'ok', stages: [] })),
      ).rejects.toThrow(CrmInvalidError);
    });

    it('createPipeline rejects duplicate slug in same org', async () => {
      await seedPipeline();
      await expect(
        run(() =>
          svc.createPipeline({ name: 'Sales 2', slug: 'sales', stages: [{ name: 'A' }] }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('listPipelines returns multiple pipelines with stages', async () => {
      await seedPipeline();
      const list = await run(() => svc.listPipelines());
      expect(list).toHaveLength(1);
      expect(list[0]!.stages).toHaveLength(4);
    });

    it('createDeal defaults to first stage when not specified', async () => {
      const p = await seedPipeline();
      const deal = await run(() => svc.createDeal({ name: 'Big Deal', pipelineId: p.id }));
      expect(deal.stageId).toBe(p.stages[0]!.id);
    });

    it('createDeal accepts explicit stageId', async () => {
      const p = await seedPipeline();
      const deal = await run(() =>
        svc.createDeal({ name: 'Big Deal', pipelineId: p.id, stageId: p.stages[1]!.id }),
      );
      expect(deal.stageId).toBe(p.stages[1]!.id);
    });

    it('createDeal 404s on missing pipeline (when stageId not given)', async () => {
      await expect(
        run(() => svc.createDeal({ name: 'X', pipelineId: randomUUID() })),
      ).rejects.toThrow(NotFoundException);
    });

    it('listDeals filters by pipeline and stage', async () => {
      const p = await seedPipeline();
      await run(() => svc.createDeal({ name: 'A', pipelineId: p.id, stageId: p.stages[0]!.id }));
      await run(() => svc.createDeal({ name: 'B', pipelineId: p.id, stageId: p.stages[1]!.id }));
      const all = await run(() => svc.listDeals({ pipelineId: p.id }));
      expect(all).toHaveLength(2);
      const onlyStage1 = await run(() =>
        svc.listDeals({ pipelineId: p.id, stageId: p.stages[1]!.id }),
      );
      expect(onlyStage1).toHaveLength(1);
      expect(onlyStage1[0]!.name).toBe('B');
    });

    it('changeStage moves to a new stage and stamps closedAt on won/lost transition', async () => {
      const p = await seedPipeline();
      const deal = await run(() => svc.createDeal({ name: 'D', pipelineId: p.id }));
      const moved = await run(() => svc.changeStage({ dealId: deal.id, stageId: p.stages[2]!.id }));
      expect(moved.stageId).toBe(p.stages[2]!.id);
      expect(moved.closedAt).not.toBeNull();
    });

    it('changeStage 404s on unknown stage and unknown deal', async () => {
      const p = await seedPipeline();
      await expect(
        run(() => svc.changeStage({ dealId: randomUUID(), stageId: p.stages[0]!.id })),
      ).rejects.toThrow(NotFoundException);
      const deal = await run(() => svc.createDeal({ name: 'D', pipelineId: p.id }));
      await expect(
        run(() => svc.changeStage({ dealId: deal.id, stageId: randomUUID() })),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Activities ──────────────────────────────────────────────────────

  describe('activities', () => {
    it('logActivity persists a record and stamps lastContactedAt on the contact', async () => {
      const c = await run(() => svc.createContact({ name: 'A', email: 'a@x' }));
      const a = await run(() =>
        svc.logActivity({ type: 'note', subject: 'Met up', contactId: c.id }),
      );
      expect(a.type).toBe('note');
      expect(a.contactId).toBe(c.id);
      const refreshed = await run(() => svc.getContact(c.id));
      expect(refreshed.lastContactedAt).not.toBeNull();
    });

    it('listActivities filters by contact / company / deal', async () => {
      const c = await run(() => svc.createContact({ name: 'A' }));
      const co = await run(() => svc.createCompany({ name: 'Acme' }));
      await run(() => svc.logActivity({ type: 'note', contactId: c.id }));
      await run(() => svc.logActivity({ type: 'note', companyId: co.id }));
      const ofContact = await run(() => svc.listActivities({ contactId: c.id }));
      expect(ofContact).toHaveLength(1);
      const ofCompany = await run(() => svc.listActivities({ companyId: co.id }));
      expect(ofCompany).toHaveLength(1);
    });
  });

  // ─── Search ──────────────────────────────────────────────────────────

  describe('search', () => {
    it('searchContacts matches by name / email / phone / title (case-insensitive)', async () => {
      await run(() => svc.createContact({ name: 'Alice', email: 'a@example.com' }));
      await run(() => svc.createContact({ name: 'Bob', email: 'bob@elsewhere.com', title: 'CTO' }));
      const byName = await run(() => svc.searchContacts({ query: 'alice' }));
      expect(byName).toHaveLength(1);
      const byEmailDomain = await run(() => svc.searchContacts({ query: 'example' }));
      expect(byEmailDomain).toHaveLength(1);
      const byTitle = await run(() => svc.searchContacts({ query: 'cto' }));
      expect(byTitle).toHaveLength(1);
    });

    it('searchContacts returns an empty array for empty/whitespace query', async () => {
      const empty = await run(() => svc.searchContacts({ query: '   ' }));
      expect(empty).toEqual([]);
    });
  });

  // ─── RLS ─────────────────────────────────────────────────────────────

  describe('merge proposals', () => {
    it('proposeMerge canonicalizes pair and returns embedded contact summaries', async () => {
      const a = await run(() => svc.createContact({ name: 'A', email: 'x@y' }));
      const b = await run(() => svc.createContact({ name: 'B', email: 'x@y' }));
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: b.id,
          contactBId: a.id,
          confidence: 'high',
          evidence: { sameEmail: 'x@y' },
          recommendedKeeperId: a.id,
        }),
      );
      const [first, second] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      expect(proposal.contactA.id).toBe(first);
      expect(proposal.contactB.id).toBe(second);
      expect(proposal.status).toBe('pending');
      expect(proposal.confidence).toBe('high');
    });

    it('proposeMerge rejects self-merge', async () => {
      const c = await run(() => svc.createContact({ name: 'A' }));
      await expect(
        run(() =>
          svc.proposeMerge({
            contactAId: c.id,
            contactBId: c.id,
            confidence: 'high',
            evidence: {},
            recommendedKeeperId: c.id,
          }),
        ),
      ).rejects.toThrow(CrmInvalidError);
    });

    it('proposeMerge rejects keeper that is not in the pair', async () => {
      const a = await run(() => svc.createContact({ name: 'A' }));
      const b = await run(() => svc.createContact({ name: 'B' }));
      const c = await run(() => svc.createContact({ name: 'C' }));
      await expect(
        run(() =>
          svc.proposeMerge({
            contactAId: a.id,
            contactBId: b.id,
            confidence: 'high',
            evidence: {},
            recommendedKeeperId: c.id,
          }),
        ),
      ).rejects.toThrow(CrmInvalidError);
    });

    it('proposeMerge upserts the existing pending row for the same pair', async () => {
      const a = await run(() => svc.createContact({ name: 'A', email: 'x@y' }));
      const b = await run(() => svc.createContact({ name: 'B', email: 'x@y' }));
      const first = await run(() =>
        svc.proposeMerge({
          contactAId: a.id,
          contactBId: b.id,
          confidence: 'medium',
          evidence: { sameEmail: 'x@y' },
          recommendedKeeperId: a.id,
        }),
      );
      const second = await run(() =>
        svc.proposeMerge({
          contactAId: b.id,
          contactBId: a.id,
          confidence: 'high',
          evidence: { sameEmail: 'x@y', samePhone: '+47900' },
          recommendedKeeperId: a.id,
          recommendedPatch: { tags: ['vip'] },
        }),
      );
      expect(second.id).toBe(first.id);
      expect(second.confidence).toBe('high');
      expect(second.evidence).toMatchObject({ samePhone: '+47900' });
      expect(second.recommendedPatch).toEqual({ tags: ['vip'] });
      const list = await run(() => svc.listMergeProposals({ status: 'pending' }));
      expect(list).toHaveLength(1);
    });

    it('listMergeProposals filters by status', async () => {
      const a = await run(() => svc.createContact({ name: 'A', email: 'x@y' }));
      const b = await run(() => svc.createContact({ name: 'B', email: 'x@y' }));
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: a.id,
          contactBId: b.id,
          confidence: 'high',
          evidence: {},
          recommendedKeeperId: a.id,
        }),
      );
      const pending = await run(() => svc.listMergeProposals({ status: 'pending' }));
      expect(pending.map((p) => p.id)).toContain(proposal.id);
      const dismissed = await run(() => svc.listMergeProposals({ status: 'dismissed' }));
      expect(dismissed).toHaveLength(0);
    });

    it('applyMergeProposal patches keeper, archives duplicate, marks applied', async () => {
      const keeper = await run(() => svc.createContact({ name: 'Keeper', email: 'k@y', tags: ['vip'] }));
      const dup = await run(() => svc.createContact({ name: 'Dup', email: 'k@y', tags: ['lead'] }));
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: keeper.id,
          contactBId: dup.id,
          confidence: 'high',
          evidence: { sameEmail: 'k@y' },
          recommendedKeeperId: keeper.id,
          recommendedPatch: { title: 'Head of Ops', tags: ['vip', 'lead'] },
        }),
      );
      const applied = await run(() => svc.applyMergeProposal({ id: proposal.id }));
      expect(applied.status).toBe('applied');
      expect(applied.decidedAt).not.toBeNull();
      const refreshedKeeper = await run(() => svc.getContact(keeper.id));
      expect(refreshedKeeper.title).toBe('Head of Ops');
      expect(refreshedKeeper.tags).toEqual(['vip', 'lead']);
      const refreshedDup = await run(() => svc.getContact(dup.id));
      expect(refreshedDup.tags.some((t) => t.startsWith('dedup-archived-'))).toBe(true);
      expect(refreshedDup.customFields.mergedInto).toBe(keeper.id);
      expect(refreshedDup.doNotContact).toBe(true);
    });

    it('applyMergeProposal coerces ISO-string timestamps in the patch and drops unknown keys', async () => {
      const keeper = await run(() => svc.createContact({ name: 'Keeper', email: 'k@y' }));
      const dup = await run(() => svc.createContact({ name: 'Dup', email: 'k@y' }));
      const givenAt = '2026-06-26T12:17:03.653Z';
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: keeper.id,
          contactBId: dup.id,
          confidence: 'high',
          evidence: { sameEmail: 'k@y' },
          recommendedKeeperId: keeper.id,
          recommendedPatch: {
            consentLawfulBasis: 'consent',
            consentGivenAt: givenAt,
            consentSource: 'self-test-outreach-flow',
            notARealColumn: 'should be dropped',
          },
        }),
      );
      const applied = await run(() => svc.applyMergeProposal({ id: proposal.id }));
      expect(applied.status).toBe('applied');
      const refreshedKeeper = await run(() => svc.getContact(keeper.id));
      expect(refreshedKeeper.consentGivenAt).toBe(givenAt);
      expect(refreshedKeeper.consentLawfulBasis).toBe('consent');
      expect(refreshedKeeper.consentSource).toBe('self-test-outreach-flow');
    });

    it('applyMergeProposal reassigns activities, deals, and contact-typed relationships from duplicate to keeper', async () => {
      const keeper = await run(() => svc.createContact({ name: 'Keeper', email: 'k@y' }));
      const dup = await run(() => svc.createContact({ name: 'Dup', email: 'k@y' }));
      const other = await run(() => svc.createContact({ name: 'Other', email: 'o@y' }));

      await run(() =>
        svc.logActivity({ type: 'note', subject: 'on dup', contactId: dup.id }),
      );
      const pipeline = await run(() =>
        svc.createPipeline({ name: 'p', slug: 'p1', stages: [{ name: 's' }] }),
      );
      const deal = await run(() =>
        svc.createDeal({ name: 'd', pipelineId: pipeline.id, primaryContactId: dup.id }),
      );

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.insert(schema.crmRelationships).values({
        orgId,
        fromType: 'contact',
        fromId: dup.id,
        toType: 'contact',
        toId: other.id,
        role: 'introduced_by',
      });
      await db.insert(schema.crmRelationships).values({
        orgId,
        fromType: 'contact',
        fromId: other.id,
        toType: 'contact',
        toId: dup.id,
        role: 'reports_to',
      });

      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: keeper.id,
          contactBId: dup.id,
          confidence: 'high',
          evidence: {},
          recommendedKeeperId: keeper.id,
        }),
      );
      await run(() => svc.applyMergeProposal({ id: proposal.id }));

      const keeperActivities = await run(() =>
        svc.listActivities({ contactId: keeper.id, limit: 50 }),
      );
      expect(keeperActivities.find((a) => a.subject === 'on dup')).toBeDefined();
      const dupActivities = await run(() =>
        svc.listActivities({ contactId: dup.id, limit: 50 }),
      );
      expect(dupActivities).toHaveLength(0);

      const refreshedDeals = await db
        .select()
        .from(schema.crmDeals)
        .where(eq(schema.crmDeals.id, deal.id));
      expect(refreshedDeals[0]?.primaryContactId).toBe(keeper.id);

      const rels = await db
        .select()
        .from(schema.crmRelationships)
        .where(eq(schema.crmRelationships.orgId, orgId));
      const rewritten = rels.filter(
        (r) =>
          (r.fromType === 'contact' && r.fromId === keeper.id) ||
          (r.toType === 'contact' && r.toId === keeper.id),
      );
      expect(rewritten.length).toBe(2);
      const stillOnDup = rels.filter(
        (r) =>
          (r.fromType === 'contact' && r.fromId === dup.id) ||
          (r.toType === 'contact' && r.toId === dup.id),
      );
      expect(stillOnDup).toHaveLength(0);
    });

    it('applyMergeProposal transfers endUserId to keeper when keeper has none and clears duplicate', async () => {
      const keeper = await run(() => svc.createContact({ name: 'Keeper', email: 'k@y' }));
      const dup = await run(() =>
        svc.createContact({ name: 'Dup', email: 'k@y', endUserId }),
      );
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: keeper.id,
          contactBId: dup.id,
          confidence: 'high',
          evidence: {},
          recommendedKeeperId: keeper.id,
        }),
      );
      await run(() => svc.applyMergeProposal({ id: proposal.id }));
      const refreshedKeeper = await run(() => svc.getContact(keeper.id));
      const refreshedDup = await run(() => svc.getContact(dup.id));
      expect(refreshedKeeper.endUserId).toBe(endUserId);
      expect(refreshedDup.endUserId).toBeNull();
    });

    it('applyMergeProposal preserves keeper endUserId when both contacts have one (clears duplicate only)', async () => {
      const otherEu = await db
        .insert(schema.endUsers)
        .values({ orgId, externalId: `eu-other-${Date.now()}`, name: 'Other EU' })
        .returning();
      const otherEuId = otherEu[0]!.id;
      const keeper = await run(() =>
        svc.createContact({ name: 'Keeper', email: 'k@y', endUserId }),
      );
      const dup = await run(() =>
        svc.createContact({ name: 'Dup', email: 'k@y', endUserId: otherEuId }),
      );
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: keeper.id,
          contactBId: dup.id,
          confidence: 'high',
          evidence: {},
          recommendedKeeperId: keeper.id,
        }),
      );
      await run(() => svc.applyMergeProposal({ id: proposal.id }));
      const refreshedKeeper = await run(() => svc.getContact(keeper.id));
      const refreshedDup = await run(() => svc.getContact(dup.id));
      expect(refreshedKeeper.endUserId).toBe(endUserId);
      expect(refreshedDup.endUserId).toBeNull();
    });

    it('applyMergeProposal rejects non-pending proposals', async () => {
      const a = await run(() => svc.createContact({ name: 'A', email: 'x@y' }));
      const b = await run(() => svc.createContact({ name: 'B', email: 'x@y' }));
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: a.id,
          contactBId: b.id,
          confidence: 'high',
          evidence: {},
          recommendedKeeperId: a.id,
        }),
      );
      await run(() => svc.applyMergeProposal({ id: proposal.id }));
      await expect(run(() => svc.applyMergeProposal({ id: proposal.id }))).rejects.toThrow(
        CrmInvalidError,
      );
    });

    it('dismissMergeProposal records reason and switches status', async () => {
      const a = await run(() => svc.createContact({ name: 'A', email: 'x@y' }));
      const b = await run(() => svc.createContact({ name: 'B', email: 'x@y' }));
      const proposal = await run(() =>
        svc.proposeMerge({
          contactAId: a.id,
          contactBId: b.id,
          confidence: 'medium',
          evidence: {},
          recommendedKeeperId: a.id,
        }),
      );
      const dismissed = await run(() =>
        svc.dismissMergeProposal({ id: proposal.id, reason: 'shared inbox' }),
      );
      expect(dismissed.status).toBe('dismissed');
      expect(dismissed.dismissReason).toBe('shared inbox');
      expect(dismissed.decidedAt).not.toBeNull();
      const dismissedList = await run(() => svc.listMergeProposals({ status: 'dismissed' }));
      expect(dismissedList).toHaveLength(1);
    });

    it('after dismissal a new proposal for the same pair can be filed (and lives alongside the dismissed one)', async () => {
      const a = await run(() => svc.createContact({ name: 'A', email: 'x@y' }));
      const b = await run(() => svc.createContact({ name: 'B', email: 'x@y' }));
      const first = await run(() =>
        svc.proposeMerge({
          contactAId: a.id,
          contactBId: b.id,
          confidence: 'medium',
          evidence: {},
          recommendedKeeperId: a.id,
        }),
      );
      await run(() => svc.dismissMergeProposal({ id: first.id }));
      const second = await run(() =>
        svc.proposeMerge({
          contactAId: a.id,
          contactBId: b.id,
          confidence: 'high',
          evidence: {},
          recommendedKeeperId: a.id,
        }),
      );
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('pending');
    });
  });

  describe('segments + consent', () => {
    beforeEach(async () => {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.execute(sql`DELETE FROM crm_segments WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM crm_activities WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM crm_contacts WHERE org_id = ${orgId}`);
    });

    it('creates and lists segments; rejects duplicate names', async () => {
      const seg = await run(() =>
        svc.createSegment({ name: 'EU contacts', filter: { tagsAny: ['eu'] } }),
      );
      expect(seg.name).toBe('EU contacts');
      expect(seg.filterDefinition.tagsAny).toEqual(['eu']);

      const list = await run(() => svc.listSegments());
      expect(list).toHaveLength(1);

      await expect(
        run(() => svc.createSegment({ name: 'EU contacts', filter: {} })),
      ).rejects.toThrow();
    });

    it('setContactConsent stores fields and logs an activity', async () => {
      const c = await run(() => svc.createContact({ name: 'Bob', email: 'bob@example.com' }));
      const updated = await run(() =>
        svc.setContactConsent({
          contactId: c.id,
          lawfulBasis: 'legitimate_interest',
          source: 'imported-2026-q2',
          evidence: { batch: 'list-2026' },
        }),
      );
      expect(updated.consentLawfulBasis).toBe('legitimate_interest');
      expect(updated.consentSource).toBe('imported-2026-q2');
      expect(updated.consentGivenAt).not.toBeNull();
      const activities = await run(() => svc.listActivities({ contactId: c.id }));
      expect(activities.some((a) => a.subject === 'Consent recorded')).toBe(true);
    });

    it('listContactsInSegment excludes suppressed and consent-less contacts', async () => {
      const seg = await run(() =>
        svc.createSegment({ name: 'all', filter: { tagsAny: ['target'] } }),
      );
      const cWithConsent = await run(() =>
        svc.createContact({ name: 'Eligible', email: 'e@x.com', tags: ['target'] }),
      );
      await run(() =>
        svc.setContactConsent({
          contactId: cWithConsent.id,
          lawfulBasis: 'consent',
          source: 'web-form',
        }),
      );
      const cNoConsent = await run(() =>
        svc.createContact({ name: 'NoConsent', email: 'n@x.com', tags: ['target'] }),
      );
      const cSuppressed = await run(() =>
        svc.createContact({ name: 'Suppressed', email: 's@x.com', tags: ['target'] }),
      );
      await run(() =>
        svc.setContactConsent({
          contactId: cSuppressed.id,
          lawfulBasis: 'consent',
          source: 'web-form',
        }),
      );
      await run(() => svc.updateContact({ id: cSuppressed.id, patch: { doNotContact: true } }));

      const audience = await run(() => svc.listContactsInSegment({ id: seg.id }));
      const ids = audience.map((c) => c.id);
      expect(ids).toContain(cWithConsent.id);
      expect(ids).not.toContain(cNoConsent.id);
      expect(ids).not.toContain(cSuppressed.id);
    });

    it('listContactsInSegment respects the filter (tagsAll AND companyId)', async () => {
      const company = await run(() => svc.createCompany({ name: 'Acme' }));
      const seg = await run(() =>
        svc.createSegment({
          name: 'Acme priority',
          filter: { tagsAll: ['priority', 'enterprise'], companyId: company.id },
        }),
      );
      const matches = await run(() =>
        svc.createContact({
          name: 'A',
          email: 'a@acme.com',
          tags: ['priority', 'enterprise', 'extra'],
          companyId: company.id,
        }),
      );
      await run(() =>
        svc.setContactConsent({ contactId: matches.id, lawfulBasis: 'contract', source: 'crm' }),
      );
      const wrongCompany = await run(() =>
        svc.createContact({
          name: 'B',
          email: 'b@elsewhere.com',
          tags: ['priority', 'enterprise'],
        }),
      );
      await run(() =>
        svc.setContactConsent({
          contactId: wrongCompany.id,
          lawfulBasis: 'contract',
          source: 'crm',
        }),
      );
      const partialTags = await run(() =>
        svc.createContact({
          name: 'C',
          email: 'c@acme.com',
          tags: ['priority'],
          companyId: company.id,
        }),
      );
      await run(() =>
        svc.setContactConsent({
          contactId: partialTags.id,
          lawfulBasis: 'contract',
          source: 'crm',
        }),
      );

      const ids = (await run(() => svc.listContactsInSegment({ id: seg.id }))).map((c) => c.id);
      expect(ids).toEqual([matches.id]);
    });
  });

  describe('RLS', () => {
    it('cross-org isolation: another org cannot see this org\'s contacts', async () => {
      const mine = await run(() => svc.createContact({ name: 'MineOnly', email: 'm@x' }));
      const [otherOrg] = await db
        .insert(schema.orgs)
        .values({ name: 'Other' })
        .returning();
      const otherActor = new ActorIdentity('admin_agent', 'agt_other', otherOrg!.id, ['*'], ['admin']);
      try {
        const list = await run(() => svc.listContacts({}), otherActor);
        expect(list.find((c) => c.id === mine.id)).toBeFalsy();
      } finally {
        await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
        await db.delete(schema.orgs).where(eq(schema.orgs.id, otherOrg!.id));
      }
    });
  });
});
