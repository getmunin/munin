import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OutreachEmailTemplatesService } from './outreach-email-templates.service.ts';
import { OutreachInvalidError } from './outreach.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run outreach email template tests.';

const TEMPLATE = `<mjml>
  <mj-body>
    {{content}}
    <mj-section>
      <mj-column>
        <mj-text>{{org_name}} · <a href="{{unsubscribe_url}}">Unsubscribe</a></mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

(skipReason ? describe.skip : describe)('OutreachEmailTemplatesService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  const svc = new OutreachEmailTemplatesService();
  let orgId: string;
  let otherOrgId: string;
  let actor: ActorIdentity;
  let otherActor: ActorIdentity;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    const [org, other] = await db
      .insert(schema.orgs)
      .values([{ name: 'Acme' }, { name: 'Globex' }])
      .returning();
    orgId = org!.id;
    otherOrgId = other!.id;
    actor = new ActorIdentity('admin_agent', 'agt_templates_test', orgId, ['*'], ['admin']);
    otherActor = new ActorIdentity('admin_agent', 'agt_templates_other', otherOrgId, ['*'], ['admin']);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id IN (${orgId}, ${otherOrgId})`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM journeys WHERE org_id IN (${orgId}, ${otherOrgId})`);
    await db.execute(sql`DELETE FROM crm_contacts WHERE org_id IN (${orgId}, ${otherOrgId})`);
    await db.execute(
      sql`DELETE FROM outreach_email_templates WHERE org_id IN (${orgId}, ${otherOrgId})`,
    );
  });

  function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${as.orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: as, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  const run = <T>(fn: () => Promise<T>) => runAs(actor, fn);

  it('creates, reads, lists, updates and deletes a template', async () => {
    const created = await run(() =>
      svc.createTemplate({ name: '  Newsletter  ', description: 'Monthly', mjml: TEMPLATE }),
    );
    expect(created).toMatchObject({ name: 'Newsletter', description: 'Monthly', isDefault: false });
    expect(created.id).toMatch(/^oetp_/);
    expect(created.warnings).toEqual([]);

    expect(await run(() => svc.getTemplate(created.id))).toMatchObject({ mjml: TEMPLATE });
    const listed = await run(() => svc.listTemplates());
    expect(listed.map((t) => t.name)).toEqual(['Newsletter']);
    expect(listed[0]).not.toHaveProperty('mjml');

    const updated = await run(() =>
      svc.updateTemplate({ id: created.id, name: 'Changelog', description: null }),
    );
    expect(updated).toMatchObject({ name: 'Changelog', description: null, mjml: TEMPLATE });

    expect(await run(() => svc.deleteTemplate(created.id))).toEqual({ deleted: true, id: created.id });
    await expect(run(() => svc.getTemplate(created.id))).rejects.toBeInstanceOf(NotFoundException);
  });

  const journeySpec = (templateId?: string) => ({
    entry: { trigger: { type: 'event', event: 'trial.started' } },
    goal: { event: 'subscription.started', windowDays: 30 },
    start: 'welcome',
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        channel: 'email',
        content: { subject: 'Velkommen', body: 'Hei!', ...(templateId ? { templateId } : {}) },
        next: 'done',
      },
      { id: 'done', type: 'exit' },
    ],
  });

  async function seedJourney(name: string, versions: { spec: Record<string, unknown>; published: boolean }[]) {
    const [journey] = await db
      .insert(schema.journeys)
      .values({
        orgId,
        name,
        status: 'live',
        liveVersion: versions.filter((v) => v.published).length || null,
        createdByActorType: 'admin_agent',
        createdByActorId: actor.id,
      })
      .returning();
    for (const [i, v] of versions.entries()) {
      await db.insert(schema.journeyVersions).values({
        orgId,
        journeyId: journey!.id,
        number: i + 1,
        spec: v.spec,
        specHash: `hash-${i + 1}`,
        createdByActorType: 'admin_agent',
        createdByActorId: actor.id,
        publishedAt: v.published ? new Date() : null,
      });
    }
    return journey!;
  }

  async function enroll(journeyId: string, version: number) {
    const [contact] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Ola Nordmann', email: `ola-${randomUUID()}@example.com`, consentLawfulBasis: 'contract' })
      .returning();
    const [enrollment] = await db
      .insert(schema.journeyEnrollments)
      .values({ orgId, journeyId, version, contactId: contact!.id, subjectKey: `contact:${contact!.id}`, state: 'waiting' })
      .returning();
    return { contact: contact!, enrollment: enrollment! };
  }

  it('lists the journey steps and queued journey emails that use a template, and refuses to delete it', async () => {
    const welcome = await run(() => svc.createTemplate({ name: 'Welcome', mjml: TEMPLATE }));
    const spare = await run(() => svc.createTemplate({ name: 'Spare', mjml: TEMPLATE }));

    const onboarding = await seedJourney('Onboarding', [
      { spec: journeySpec(welcome.id), published: true },
      { spec: journeySpec(spare.id), published: true },
      { spec: journeySpec(welcome.id), published: false },
    ]);
    await seedJourney('Retired', [{ spec: journeySpec(spare.id), published: true }, { spec: journeySpec(), published: true }]);
    const { contact } = await enroll(onboarding.id, 1);
    await db.insert(schema.outreachProposals).values({
      orgId,
      journeyId: onboarding.id,
      contactId: contact.id,
      kind: 'journey',
      journeyDelivery: { channel: 'email', format: 'markdown', templateId: welcome.id, templateHash: 'h', preheader: null, policy: { class: 'marketing', cooldownHoursAfterConversation: 24 }, auto: true },
      draftBody: 'Hei',
      status: 'approved',
      proposedByActorType: 'system',
      proposedByActorId: 'journey-runtime',
    });

    const usage = (await run(() => svc.getTemplate(welcome.id))).usage;
    expect(usage.journeySteps.map((s) => [s.journeyName, s.version, s.versionRole, s.nodeId, s.viaDefault])).toEqual([
      ['Onboarding', 1, 'in_flight', 'welcome', false],
      ['Onboarding', 3, 'draft', 'welcome', false],
    ]);
    expect(usage.queuedJourneyEmails).toBe(1);
    expect(usage.broadcasts).toEqual([]);

    expect((await run(() => svc.getTemplate(spare.id))).usage.journeySteps.map((s) => [s.journeyName, s.versionRole])).toEqual([
      ['Onboarding', 'live'],
    ]);

    await expect(run(() => svc.deleteTemplate(welcome.id))).rejects.toThrow(
      /still used by 2 journey steps, 1 queued journey email \(step "welcome" of journey "Onboarding"/,
    );
    await expect(run(() => svc.deleteTemplate(spare.id))).rejects.toBeInstanceOf(ConflictException);
  });

  it('counts steps without a template against the default, without blocking its deletion', async () => {
    const house = await run(() => svc.createTemplate({ name: 'House', mjml: TEMPLATE, isDefault: true }));
    await seedJourney('Win-back', [{ spec: journeySpec(), published: true }]);

    const usage = (await run(() => svc.getTemplate(house.id))).usage;
    expect(usage.journeySteps).toMatchObject([{ journeyName: 'Win-back', versionRole: 'live', viaDefault: true }]);
    expect(await run(() => svc.deleteTemplate(house.id))).toEqual({ deleted: true, id: house.id });
  });

  it('refuses invalid MJML on create and update without saving anything', async () => {
    await expect(
      run(() => svc.createTemplate({ name: 'Broken', mjml: TEMPLATE.replace('{{content}}', '') })),
    ).rejects.toBeInstanceOf(OutreachInvalidError);
    expect(await run(() => svc.listTemplates())).toEqual([]);

    const created = await run(() => svc.createTemplate({ name: 'Good', mjml: TEMPLATE }));
    await expect(
      run(() =>
        svc.updateTemplate({ id: created.id, mjml: TEMPLATE.replace('<mj-body>', '<mj-body><mj-raw><script></script></mj-raw>') }),
      ),
    ).rejects.toThrow(/<script> element/);
    expect((await run(() => svc.getTemplate(created.id))).mjml).toBe(TEMPLATE);
  });

  it('pre-checks name uniqueness so a clash is a conflict, not a failed transaction', async () => {
    const first = await run(() => svc.createTemplate({ name: 'Newsletter', mjml: TEMPLATE }));
    const second = await run(() => svc.createTemplate({ name: 'Changelog', mjml: TEMPLATE }));
    await expect(
      run(() => svc.createTemplate({ name: 'Newsletter', mjml: TEMPLATE })),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      run(() => svc.updateTemplate({ id: second.id, name: 'Newsletter' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await run(() => svc.updateTemplate({ id: first.id, name: 'Newsletter' }))).name).toBe(
      'Newsletter',
    );
  });

  it('keeps at most one default and lists it first', async () => {
    const a = await run(() => svc.createTemplate({ name: 'B first', mjml: TEMPLATE, isDefault: true }));
    const b = await run(() => svc.createTemplate({ name: 'A second', mjml: TEMPLATE, isDefault: true }));
    let listed = await run(() => svc.listTemplates());
    expect(listed.map((t) => [t.name, t.isDefault])).toEqual([
      ['A second', true],
      ['B first', false],
    ]);

    await run(() => svc.updateTemplate({ id: a.id, isDefault: true }));
    listed = await run(() => svc.listTemplates());
    expect(listed.filter((t) => t.isDefault).map((t) => t.id)).toEqual([a.id]);

    await run(() => svc.updateTemplate({ id: a.id, isDefault: false }));
    listed = await run(() => svc.listTemplates());
    expect(listed.some((t) => t.isDefault)).toBe(false);
    expect(b.id).toBeTruthy();
  });

  it('hides one org’s templates from another', async () => {
    const created = await run(() => svc.createTemplate({ name: 'Private', mjml: TEMPLATE }));
    expect(await runAs(otherActor, () => svc.listTemplates())).toEqual([]);
    await expect(runAs(otherActor, () => svc.getTemplate(created.id))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const otherDefault = await runAs(otherActor, () =>
      svc.createTemplate({ name: 'Private', mjml: TEMPLATE, isDefault: true }),
    );
    expect(otherDefault.isDefault).toBe(true);
  });

  it('previews a saved template, unsaved MJML, or the default with the org name filled in', async () => {
    const saved = await run(() => svc.createTemplate({ name: 'Default', mjml: TEMPLATE, isDefault: true }));
    const content = { format: 'markdown' as const, body: 'Hi {{name|there}}, three things shipped.' };

    const byId = await run(() => svc.previewTemplate({ templateId: saved.id, content, name: 'Kari' }));
    expect(byId.templateId).toBe(saved.id);
    expect(byId.html).toContain('Hi Kari, three things shipped.');
    expect(byId.html).toContain('Acme · ');
    expect(byId.html).toContain('/v1/outreach/unsubscribe?token=preview');
    expect(byId.text).toContain('Hi Kari, three things shipped.');
    expect(byId.htmlBytes).toBeGreaterThan(0);

    const byDefault = await run(() => svc.previewTemplate({ content }));
    expect(byDefault.templateId).toBe(saved.id);
    expect(byDefault.html).toContain('Hi there, three things shipped.');

    const unsaved = await run(() =>
      svc.previewTemplate({ mjml: TEMPLATE.replace('{{org_name}} · ', 'Draft · '), content }),
    );
    expect(unsaved.templateId).toBeNull();
    expect(unsaved.html).toContain('Draft · ');

    await expect(
      run(() => svc.previewTemplate({ templateId: saved.id, mjml: TEMPLATE, content })),
    ).rejects.toThrow(/either templateId or mjml/);
  });

  it('explains how to preview when the org has no default template', async () => {
    await expect(
      run(() => svc.previewTemplate({ content: { format: 'markdown', body: 'Hello' } })),
    ).rejects.toThrow(/no default email template/);
  });
});
