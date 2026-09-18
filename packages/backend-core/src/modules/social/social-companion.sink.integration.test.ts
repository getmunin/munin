import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import {
  ActorIdentity,
  withContext,
  type EmittedEvent,
  type RequestContext,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { SocialCompanionSink, type JobEnqueuer } from './social-companion.sink.ts';
import { SocialService } from './social.service.ts';
import {
  StubPublisherLookup,
  StubTokenSource,
  StubEventEmitter,
  UnusedTransactionRunner,
} from './social-test-doubles.ts';
import { COMPANION_JOB_URI } from './companion-job.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run social companion sink tests.';

const ARTICLE_URL = 'https://example.test/blog/nine-in-ten';

class RecordingEnqueuer implements JobEnqueuer {
  readonly jobs: { jobUri: string; userPrompt: string; dedupeKey?: string }[] = [];

  enqueue(input: { jobUri: string; userPrompt: string; dedupeKey?: string }): Promise<unknown> {
    this.jobs.push(input);
    return Promise.resolve({});
  }
}

(skipReason ? describe.skip : describe)('SocialCompanionSink', () => {
  let svcDb: ReturnType<typeof createDb>;
  let orgA: string;
  let orgB: string;
  let optedIn: string;
  let optedOut: string;

  const enqueuer = new RecordingEnqueuer();
  const sink = new SocialCompanionSink(enqueuer);
  const social = new SocialService(
    new StubTokenSource(),
    new StubPublisherLookup(),
    new UnusedTransactionRunner(),
    new StubEventEmitter(),
  );

  async function asOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('system', 'cms-schedule-worker', orgId, ['*'], ['admin']);
    return await svcDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return await withContext(ctx, fn);
    });
  }

  function published(
    overrides: Record<string, unknown> = {},
    orgId: string = orgA,
  ): EmittedEvent {
    return {
      eventId: `evt_${randomUUID()}`,
      orgId,
      type: 'cms.entry.published',
      payload: {
        entryId: 'cme_test_1',
        collectionSlug: 'articles',
        slug: 'nine-in-ten',
        locale: 'en',
        status: 'published',
        version: 2,
        previousStatus: 'draft',
        title: 'Nine in ten tickets',
        url: ARTICLE_URL,
        ...overrides,
      },
    };
  }

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    svcDb = createDb(TEST_URL!, { serviceRole: true });
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const orgs = await svcDb
      .insert(schema.orgs)
      .values([{ name: 'Acme Companion' }, { name: 'Globex Companion' }])
      .returning();
    orgA = orgs[0]!.id;
    orgB = orgs[1]!.id;

    const collections = await svcDb
      .insert(schema.cmsCollections)
      .values([
        {
          orgId: orgA,
          name: 'Articles',
          slug: 'articles',
          settings: { socialDraftOnPublish: true },
        },
        { orgId: orgA, name: 'Team', slug: 'team', settings: {} },
        { orgId: orgB, name: 'Articles', slug: 'articles', settings: {} },
      ])
      .returning();
    optedIn = collections[0]!.id;
    optedOut = collections[1]!.id;
  });

  afterAll(async () => {
    if (!svcDb) return;
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await svcDb.delete(schema.orgs).where(sql`id IN (${orgA}, ${orgB})`);
  });

  beforeEach(async () => {
    enqueuer.jobs.length = 0;
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await svcDb.delete(schema.socialPostDrafts);
  });

  it('enqueues a drafting pass when the collection opted in', async () => {
    await asOrg(orgA, () => sink.onEvent(published()));
    expect(enqueuer.jobs).toHaveLength(1);
    expect(enqueuer.jobs[0]!.jobUri).toBe(COMPANION_JOB_URI);
    expect(enqueuer.jobs[0]!.dedupeKey).toBe('social-companion:entry:cme_test_1');
    expect(enqueuer.jobs[0]!.userPrompt).toContain(ARTICLE_URL);
  });

  it('stays quiet for a collection that never opted in', async () => {
    await asOrg(orgA, () => sink.onEvent(published({ collectionSlug: 'team' })));
    expect(enqueuer.jobs).toHaveLength(0);
    expect(optedOut).toBeTruthy();
  });

  it('stays quiet when the entry has no live url to link to', async () => {
    await asOrg(orgA, () => sink.onEvent(published({ url: null })));
    expect(enqueuer.jobs).toHaveLength(0);
  });

  it('stays quiet when an already-published entry is published again', async () => {
    await asOrg(orgA, () => sink.onEvent(published({ previousStatus: 'published' })));
    expect(enqueuer.jobs).toHaveLength(0);
  });

  it('runs for an entry promoted off the schedule', async () => {
    await asOrg(orgA, () => sink.onEvent(published({ previousStatus: 'scheduled' })));
    expect(enqueuer.jobs).toHaveLength(1);
  });

  it('does not draft a second set for an entry that already has one', async () => {
    await asOrg(orgA, () =>
      social.proposeSet({
        linkUrl: ARTICLE_URL,
        sourceRef: { type: 'cms_entry', id: 'cme_test_1' },
        variants: [{ variantLabel: 'practitioner', body: 'Already drafted.' }],
      }),
    );
    await asOrg(orgA, () => sink.onEvent(published()));
    expect(enqueuer.jobs).toHaveLength(0);
  });

  it('ignores a set another org holds for the same entry id', async () => {
    await asOrg(orgB, () =>
      social.proposeSet({
        linkUrl: ARTICLE_URL,
        sourceRef: { type: 'cms_entry', id: 'cme_test_1' },
        variants: [{ variantLabel: 'practitioner', body: 'Globex wrote this.' }],
      }),
    );
    await asOrg(orgA, () => sink.onEvent(published()));
    expect(enqueuer.jobs).toHaveLength(1);
  });

  it('does not read another org collection that shares the slug', async () => {
    await asOrg(orgB, () => sink.onEvent(published({}, orgB)));
    expect(enqueuer.jobs).toHaveLength(0);
    expect(optedIn).toBeTruthy();
  });
});
