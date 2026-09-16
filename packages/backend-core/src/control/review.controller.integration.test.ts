import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.ts';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run review controller tests.';

const HOUR = 60 * 60 * 1000;

interface ReviewItem {
  id: string;
  kind: string;
  state: string;
  at: string;
  raw: Record<string, unknown>;
  outcome?: string;
  reason?: string | null;
  decidedBy?: { actorType: string; actorId: string; name: string | null };
  producedRef?: { type: string; id: string } | null;
}

interface ReviewResponse {
  items: ReviewItem[];
  nextCursor: string | null;
}

(skipReason ? describe.skip : describe)('GET /v1/review', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let sessionToken: string;
  const seeded: Record<string, string> = {};

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const label = `review-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [org] = await db.insert(schema.orgs).values({ name: `Org ${label}` }).returning();
    orgId = org!.id;

    const [user] = await db
      .insert(schema.users)
      .values({ email: `${label}@example.com`, name: 'Owner User' })
      .returning();
    const userId = user!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId, role: 'owner', isDefault: true });

    sessionToken = randomToken(32);
    await db.insert(schema.sessions).values({
      userId,
      token: sessionToken,
      expiresAt: new Date(Date.now() + HOUR),
    });

    const [space] = await db
      .insert(schema.kbSpaces)
      .values({ orgId, name: 'Curation inbox', slug: `inbox-${label}` })
      .returning();
    const [candidate] = await db
      .insert(schema.kbDocuments)
      .values({
        orgId,
        spaceId: space!.id,
        title: 'Refund window',
        body: 'Refunds inside 30 days.',
        tags: ['candidate'],
        contentHash: 'hash-candidate',
        createdByType: 'agent',
        createdById: 'agent:test',
        updatedByType: 'agent',
        updatedById: 'agent:test',
        updatedAt: new Date(Date.now() - 3 * HOUR),
      })
      .returning();
    seeded['kb'] = candidate!.id;

    const contacts = await db
      .insert(schema.crmContacts)
      .values([
        { orgId, name: 'Ada L', email: `ada-${label}@example.com` },
        { orgId, name: 'Ada Lovelace', email: `ada.l-${label}@example.com` },
      ])
      .returning();
    const [merge] = await db
      .insert(schema.crmMergeProposals)
      .values({
        orgId,
        contactAId: contacts[0]!.id,
        contactBId: contacts[1]!.id,
        confidence: 'high',
        recommendedKeeperId: contacts[0]!.id,
        proposedByActorType: 'agent',
        proposedByActorId: 'agent:test',
        createdAt: new Date(Date.now() - 2 * HOUR),
      })
      .returning();
    seeded['crm'] = merge!.id;

    const [segment] = await db
      .insert(schema.crmSegments)
      .values({
        orgId,
        name: 'Everyone',
        createdByActorType: 'agent',
        createdByActorId: 'agent:test',
      })
      .returning();
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: `${label}-channel` })
      .returning();
    const [campaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'Spring launch',
        brief: 'Announce the spring release.',
        segmentId: segment!.id,
        channelId: channel!.id,
        createdByActorType: 'agent',
        createdByActorId: 'agent:test',
      })
      .returning();
    const [pending] = await db
      .insert(schema.outreachProposals)
      .values({
        orgId,
        campaignId: campaign!.id,
        contactId: contacts[0]!.id,
        kind: 'initial',
        draftBody: 'Hello there',
        proposedByActorType: 'agent',
        proposedByActorId: 'agent:test',
        createdAt: new Date(Date.now() - HOUR),
      })
      .returning();
    seeded['outreach'] = pending!.id;

    const [scheduledProposal] = await db
      .insert(schema.outreachProposals)
      .values({
        orgId,
        campaignId: campaign!.id,
        contactId: contacts[1]!.id,
        kind: 'followup',
        draftBody: 'Following up',
        status: 'approved',
        scheduledSendAt: new Date(Date.now() + 2 * HOUR),
        proposedByActorType: 'agent',
        proposedByActorId: 'agent:test',
      })
      .returning();
    seeded['outreachScheduled'] = scheduledProposal!.id;

    const [approvedUnscheduled] = await db
      .insert(schema.outreachProposals)
      .values({
        orgId,
        campaignId: campaign!.id,
        contactId: contacts[0]!.id,
        kind: 'reply',
        draftBody: 'No send time yet',
        status: 'approved',
        proposedByActorType: 'agent',
        proposedByActorId: 'agent:test',
      })
      .returning();
    seeded['outreachApprovedUnscheduled'] = approvedUnscheduled!.id;

    const [collection] = await db
      .insert(schema.cmsCollections)
      .values({ orgId, name: 'Posts', slug: `posts-${label}` })
      .returning();
    const [draft] = await db
      .insert(schema.cmsEntries)
      .values({
        orgId,
        collectionId: collection!.id,
        slug: `draft-${label}`,
        locale: 'en',
        contentHash: 'hash-draft',
        createdByType: 'agent',
        createdById: 'agent:test',
        updatedByType: 'agent',
        updatedById: 'agent:test',
        updatedAt: new Date(Date.now() - 4 * HOUR),
      })
      .returning();
    seeded['cms'] = draft!.id;

    const [scheduledEntry] = await db
      .insert(schema.cmsEntries)
      .values({
        orgId,
        collectionId: collection!.id,
        slug: `scheduled-${label}`,
        locale: 'en',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + HOUR),
        contentHash: 'hash-scheduled',
        createdByType: 'agent',
        createdById: 'agent:test',
        updatedByType: 'agent',
        updatedById: 'agent:test',
      })
      .returning();
    seeded['cmsScheduled'] = scheduledEntry!.id;

    const [publishedDoc] = await db
      .insert(schema.kbDocuments)
      .values({
        orgId,
        spaceId: space!.id,
        title: 'Shipping times',
        body: 'Two to four days.',
        contentHash: 'hash-published',
        createdByType: 'user',
        createdById: userId,
        updatedByType: 'user',
        updatedById: userId,
      })
      .returning();
    seeded['kbPublishedDoc'] = publishedDoc!.id;
    const [decision] = await db
      .insert(schema.kbCurationDecisions)
      .values({
        orgId,
        candidateDocumentId: 'kdoc_gone',
        title: 'Shipping times',
        outcome: 'published',
        publishedDocumentId: publishedDoc!.id,
        decidedByActorType: 'user',
        decidedByActorId: userId,
        decidedAt: new Date(Date.now() - 5 * HOUR),
      })
      .returning();
    seeded['kbDecision'] = decision!.id;

    const moreContacts = await db
      .insert(schema.crmContacts)
      .values([
        { orgId, name: 'Grace H', email: `grace-${label}@example.com` },
        { orgId, name: 'Grace Hopper', email: `grace.h-${label}@example.com` },
      ])
      .returning();
    const [decidedMerge] = await db
      .insert(schema.crmMergeProposals)
      .values({
        orgId,
        contactAId: moreContacts[0]!.id,
        contactBId: moreContacts[1]!.id,
        confidence: 'medium',
        recommendedKeeperId: moreContacts[0]!.id,
        status: 'dismissed',
        dismissReason: 'Different people',
        proposedByActorType: 'agent',
        proposedByActorId: 'agent:test',
        decidedByActorType: 'user',
        decidedByActorId: userId,
        decidedAt: new Date(Date.now() - 6 * HOUR),
      })
      .returning();
    seeded['crmDecided'] = decidedMerge!.id;

    const [sentProposal] = await db
      .insert(schema.outreachProposals)
      .values({
        orgId,
        campaignId: campaign!.id,
        contactId: moreContacts[0]!.id,
        kind: 'initial',
        draftBody: 'Already sent',
        status: 'sent',
        sentAt: new Date(Date.now() - 7 * HOUR),
        proposedByActorType: 'agent',
        proposedByActorId: 'agent:test',
        decidedByActorType: 'user',
        decidedByActorId: userId,
        decidedAt: new Date(Date.now() - 7 * HOUR),
      })
      .returning();
    seeded['outreachSent'] = sentProposal!.id;

    const [archivedEntry] = await db
      .insert(schema.cmsEntries)
      .values({
        orgId,
        collectionId: collection!.id,
        slug: `archived-${label}`,
        locale: 'en',
        status: 'archived',
        archivedAt: new Date(Date.now() - 8 * HOUR),
        dismissReason: 'Superseded by the launch post',
        contentHash: 'hash-archived',
        createdByType: 'agent',
        createdById: 'agent:test',
        updatedByType: 'agent',
        updatedById: 'agent:test',
      })
      .returning();
    seeded['cmsArchived'] = archivedEntry!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      if (orgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    }
  });

  async function get(path: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      headers: { Cookie: `better-auth.session_token=${sessionToken}.placeholder-sig` },
    });
  }

  async function review(state: string): Promise<ReviewResponse> {
    const res = await get(`/v1/review?state=${state}`);
    expect(res.status).toBe(200);
    return (await res.json()) as ReviewResponse;
  }

  it('returns one waiting item per pending kind', async () => {
    const body = await review('waiting');
    const byKind = new Map(body.items.map((i) => [i.kind, i.id]));
    expect(byKind.get('kb')).toBe(seeded['kb']);
    expect(byKind.get('crm')).toBe(seeded['crm']);
    expect(byKind.get('outreach')).toBe(seeded['outreach']);
    expect(byKind.get('cms')).toBe(seeded['cms']);
    expect(body.items.every((i) => i.state === 'waiting')).toBe(true);
  });

  it('omits feedback while the module is disabled', async () => {
    const body = await review('waiting');
    expect(body.items.some((i) => i.kind === 'feedback')).toBe(false);
  });

  it('sorts waiting newest first and scheduled soonest first', async () => {
    const waiting = await review('waiting');
    const waitingTimes = waiting.items.map((i) => new Date(i.at).getTime());
    expect(waitingTimes).toEqual([...waitingTimes].sort((a, b) => b - a));

    const scheduled = await review('scheduled');
    const scheduledTimes = scheduled.items.map((i) => new Date(i.at).getTime());
    expect(scheduledTimes).toEqual([...scheduledTimes].sort((a, b) => a - b));
  });

  it('treats an approved proposal as scheduled only once it has a send time', async () => {
    const scheduled = await review('scheduled');
    const ids = scheduled.items.map((i) => i.id);
    expect(ids).toContain(seeded['outreachScheduled']);
    expect(ids).toContain(seeded['cmsScheduled']);
    expect(ids).not.toContain(seeded['outreachApprovedUnscheduled']);

    const waiting = await review('waiting');
    expect(waiting.items.map((i) => i.id)).not.toContain(seeded['outreachApprovedUnscheduled']);
  });

  it('returns a decided item for every kind, newest first', async () => {
    const body = await review('decided');
    const byKind = new Map(body.items.map((i) => [i.kind, i]));
    expect(byKind.get('kb')?.id).toBe(seeded['kbDecision']);
    expect(byKind.get('crm')?.id).toBe(seeded['crmDecided']);
    expect(byKind.get('outreach')?.id).toBe(seeded['outreachSent']);
    expect(byKind.get('cms')?.id).toBe(seeded['cmsArchived']);
    expect(body.items.every((i) => i.state === 'decided')).toBe(true);

    const times = body.items.map((i) => new Date(i.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('carries the outcome, reason, decider and what each decision produced', async () => {
    const body = await review('decided');
    const byKind = new Map(body.items.map((i) => [i.kind, i]));

    const kb = byKind.get('kb');
    expect(kb?.outcome).toBe('approved');
    expect(kb?.producedRef).toEqual({ type: 'kb_document', id: seeded['kbPublishedDoc'] });
    expect(kb?.decidedBy?.actorType).toBe('user');
    expect(kb?.decidedBy?.name).toBe('Owner User');

    const crm = byKind.get('crm');
    expect(crm?.outcome).toBe('dismissed');
    expect(crm?.reason).toBe('Different people');

    const outreach = byKind.get('outreach');
    expect(outreach?.outcome).toBe('approved');

    const cms = byKind.get('cms');
    expect(cms?.outcome).toBe('dismissed');
    expect(cms?.reason).toBe('Superseded by the launch post');
    expect(cms?.producedRef).toEqual({ type: 'cms_entry', id: seeded['cmsArchived'] });
    expect(cms?.decidedBy?.actorType).toBe('agent');
  });

  it('never repeats an item across cursor pages', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const query: string = cursor
        ? `/v1/review?state=decided&limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/v1/review?state=decided&limit=2';
      const res = await get(query);
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReviewResponse;
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    const all = await review('decided');
    expect(seen.sort()).toEqual(all.items.map((i) => i.id).sort());
  });

  it('leaves a waiting or scheduled item out of the decided feed', async () => {
    const body = await review('decided');
    const ids = body.items.map((i) => i.id);
    expect(ids).not.toContain(seeded['kb']);
    expect(ids).not.toContain(seeded['outreachScheduled']);
    expect(ids).not.toContain(seeded['outreachApprovedUnscheduled']);
    expect(ids).not.toContain(seeded['cms']);
  });

  it('defaults to waiting and rejects a state it cannot list', async () => {
    const res = await get('/v1/review');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewResponse;
    expect(body.items.every((i) => i.state === 'waiting')).toBe(true);
    expect(body.nextCursor).toBeNull();

    const bad = await get('/v1/review?state=nonsense');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toContain('review_invalid');
  });

  it('agrees with the queue /v1/inbox still serves', async () => {
    const res = await get('/v1/inbox');
    expect(res.status).toBe(200);
    const inbox = (await res.json()) as {
      queue: { kb: Array<{ id: string }>; cmsScheduled: Array<{ id: string }> };
    };
    const waiting = await review('waiting');
    expect(inbox.queue.kb.map((k) => k.id)).toEqual(
      waiting.items.filter((i) => i.kind === 'kb').map((i) => i.id),
    );
    const scheduled = await review('scheduled');
    expect(inbox.queue.cmsScheduled.map((c) => c.id)).toEqual(
      scheduled.items.filter((i) => i.kind === 'cms').map((i) => i.id),
    );
  });
});
