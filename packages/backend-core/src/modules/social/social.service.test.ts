import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDb, runMigrations, schema, type Db, type Tx } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { SocialService } from './social.service.ts';
import { describePlatform } from './social-platform.ts';
import {
  StubPublisherLookup,
  StubTokenSource,
  UnusedTransactionRunner,
} from './social-test-doubles.ts';
import type { RootTransactionRunner } from './social.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run social service tests.';

const ARTICLE = 'https://example.test/blog/agentic-support';
const PERMALINK = 'https://social.example.test/posts/7';

(skipReason ? describe.skip : describe)('SocialService', () => {
  let svcDb: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgA: string;
  let orgB: string;
  let member: string;
  let outsider: string;
  const service = new SocialService(
    new StubTokenSource(),
    new StubPublisherLookup(),
    new UnusedTransactionRunner(),
  );

  async function inOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    return await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return await withContext(ctx, fn);
    });
  }

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    svcDb = createDb(TEST_URL!, { serviceRole: true });
    appDb = createDb(
      TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@'),
    );

    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const orgs = await svcDb
      .insert(schema.orgs)
      .values([{ name: 'Acme Social' }, { name: 'Globex Social' }])
      .returning();
    orgA = orgs[0]!.id;
    orgB = orgs[1]!.id;

    const users = await svcDb
      .insert(schema.users)
      .values([
        { name: 'Ola Nordmann', email: `ola-${randomUUID()}@example.test` },
        { name: 'Kari Nordmann', email: `kari-${randomUUID()}@example.test` },
      ])
      .returning();
    member = users[0]!.id;
    outsider = users[1]!.id;
    await svcDb.insert(schema.orgMembers).values({ orgId: orgA, userId: member, role: 'owner' });
  });

  afterAll(async () => {
    if (!svcDb) return;
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await svcDb.delete(schema.orgs).where(sql`id IN (${orgA}, ${orgB})`);
    await svcDb.delete(schema.users).where(sql`id IN (${member}, ${outsider})`);
  });

  beforeEach(async () => {
    await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await svcDb.delete(schema.socialPostDrafts);
  });

  describe('publishDraft', () => {
    class DbRootTransactionRunner implements RootTransactionRunner {
      constructor(private readonly db: Db) {}
      inRootTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
        return this.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
          return fn(tx);
        });
      }
    }

    function buildService(publisher: StubPublisherLookup, token = new StubTokenSource()) {
      return new SocialService(token, publisher, new DbRootTransactionRunner(svcDb));
    }

    async function asUser<T>(orgId: string, userId: string, fn: () => Promise<T>): Promise<T> {
      const actor = new ActorIdentity(
        'user',
        userId,
        orgId,
        ['*'],
        ['admin'],
        undefined,
        undefined,
        undefined,
        userId,
      );
      return await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        return await withContext(ctx, fn);
      });
    }

    async function connectAccount(orgId: string, userId: string, status = 'active') {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await svcDb.insert(schema.socialAccounts).values({
        orgId,
        userId,
        platform: 'linkedin',
        externalAccountId: `ext-${randomUUID()}`,
        displayName: 'Ola Nordmann',
        encryptedAccessToken: 'ciphertext',
        scopes: ['w_member_social'],
        status,
      });
    }

    async function readDraft(id: string) {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const [row] = await svcDb
        .select()
        .from(schema.socialPostDrafts)
        .where(eq(schema.socialPostDrafts.id, id));
      return row!;
    }

    beforeEach(async () => {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await svcDb.delete(schema.socialAccounts);
    });

    it("publishes from the caller's own account and records the post id and permalink", async () => {
      await connectAccount(orgA, member);
      const publisher = new StubPublisherLookup({
        result: { externalPostId: 'urn:li:share:9', permalink: 'https://example.test/p/9' },
      });
      const svc = buildService(publisher);

      const draft = await inOrg(orgA, () =>
        service.createDraft({ body: 'Worth sharing.', linkUrl: ARTICLE }),
      );
      const published = await asUser(orgA, member, () => svc.publishDraft(draft.id));

      expect(published.status).toBe('published');
      expect(published.externalPostId).toBe('urn:li:share:9');
      expect(published.permalink).toBe('https://example.test/p/9');
      expect(published.publishedAt).toBeTruthy();

      expect(publisher.requests).toHaveLength(1);
      expect(publisher.requests[0]!.body).toBe('Worth sharing.');
      expect(publisher.requests[0]!.linkUrl).toContain('utm_source=linkedin');
    });

    it('refuses when the caller has connected no account, and leaves the draft pending', async () => {
      const svc = buildService(new StubPublisherLookup());
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));

      await expect(asUser(orgA, member, () => svc.publishDraft(draft.id))).rejects.toMatchObject({
        response: { code: 'social_no_account' },
      });
      expect((await readDraft(draft.id)).status).toBe('pending');
    });

    it('asks for a reconnection when the account has lapsed rather than attempting the post', async () => {
      await connectAccount(orgA, member, 'expired');
      const publisher = new StubPublisherLookup();
      const svc = buildService(publisher);
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));

      await expect(asUser(orgA, member, () => svc.publishDraft(draft.id))).rejects.toMatchObject({
        response: { code: 'social_reconnect_required' },
      });
      expect(publisher.requests).toHaveLength(0);
      expect((await readDraft(draft.id)).status).toBe('pending');
    });

    it('refuses a service key outright, because a post needs a person to publish it', async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup());
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));

      await expect(inOrg(orgA, () => svc.publishDraft(draft.id))).rejects.toMatchObject({
        response: { code: 'social_publish_needs_person' },
      });
    });

    it('records the platform refusal on the draft, and that marker survives the error thrown', async () => {
      await connectAccount(orgA, member);
      const svc = buildService(
        new StubPublisherLookup({ error: new Error('LinkedIn refused the post (422)') }),
      );
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));

      await expect(asUser(orgA, member, () => svc.publishDraft(draft.id))).rejects.toMatchObject({
        response: { code: 'social_publish_failed' },
      });

      const row = await readDraft(draft.id);
      expect(row.status).toBe('failed');
      expect(row.lastError).toContain('422');
      expect(row.decidedAt).toBeTruthy();
    });

    it('refuses a draft somebody already decided', async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup());
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));
      await inOrg(orgA, () => service.dismissDraft(draft.id, 'not now'));

      await expect(asUser(orgA, member, () => svc.publishDraft(draft.id))).rejects.toThrow(
        /already dismissed/,
      );
    });

    it('says plainly when the platform has no publishing route rather than pretending', async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup({ unsupported: true }));
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));

      await expect(asUser(orgA, member, () => svc.publishDraft(draft.id))).rejects.toMatchObject({
        response: { code: 'social_publish_unsupported' },
      });
      expect((await readDraft(draft.id)).status).toBe('pending');
    });

    it("reports the viewer's own connected account, and nobody else's", async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup());

      const mine = await asUser(orgA, member, () => svc.publishTargetForViewer());
      expect(mine?.userId).toBe(member);
      expect(mine?.displayName).toBe('Ola Nordmann');

      const theirs = await asUser(orgA, outsider, () => svc.publishTargetForViewer());
      expect(theirs).toBeNull();
    });
  });

  it('stores a one-off share as a set of one', async () => {
    const draft = await inOrg(orgA, () =>
      service.createDraft({ body: 'A thought worth sharing.', linkUrl: ARTICLE }),
    );
    expect(draft.status).toBe('pending');
    expect(draft.variantLabel).toBe('single');
    expect(draft.setId).toBeTruthy();

    const all = await inOrg(orgA, () => service.listDrafts({ setId: draft.setId }));
    expect(all).toHaveLength(1);
  });

  it('groups proposed variants under one set and tags each link differently', async () => {
    const drafts = await inOrg(orgA, () =>
      service.proposeSet({
        linkUrl: ARTICLE,
        sourceRef: { type: 'cms_entry', id: 'cme_1' },
        variants: [
          { variantLabel: 'practitioner', body: 'What this changes on a Tuesday morning.' },
          { variantLabel: 'contrarian', body: 'The advice everyone repeats is wrong.' },
          { variantLabel: 'data', body: 'Nine in ten tickets never needed a human.' },
        ],
      }),
    );

    expect(drafts).toHaveLength(3);
    expect(new Set(drafts.map((d) => d.setId)).size).toBe(1);

    const contents = drafts.map((d) => new URL(d.shareUrl!).searchParams.get('utm_content'));
    expect(contents.sort()).toEqual(['contrarian', 'data', 'practitioner']);

    const campaigns = new Set(
      drafts.map((d) => new URL(d.shareUrl!).searchParams.get('utm_campaign')),
    );
    expect(campaigns.size).toBe(1);
    expect([...campaigns][0]).toBe(drafts[0]!.setId);
  });

  it('keeps the stored link clean and puts tracking only on the share URL', async () => {
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body', linkUrl: ARTICLE }));
    expect(draft.linkUrl).toBe(ARTICLE);
    expect(draft.shareUrl).toContain('utm_source=linkedin');
    expect(draft.linkUrl).not.toContain('utm_');
  });

  it('refuses a body past the platform limit and says how far over it is', async () => {
    const limit = describePlatform('linkedin').limits.maxBodyChars;
    await expect(
      inOrg(orgA, () => service.createDraft({ body: 'x'.repeat(limit + 7) })),
    ).rejects.toThrow(/social_invalid.*7 characters over/);
  });

  it('refuses two variants sharing a label', async () => {
    await expect(
      inOrg(orgA, () =>
        service.proposeSet({
          variants: [
            { variantLabel: 'story', body: 'one' },
            { variantLabel: 'story', body: 'two' },
          ],
        }),
      ),
    ).rejects.toThrow(/social_conflict.*story/);
  });

  it('refuses an empty body and a link that is not http', async () => {
    await expect(inOrg(orgA, () => service.createDraft({ body: '   ' }))).rejects.toThrow(
      /social_invalid.*empty/,
    );
    await expect(
      inOrg(orgA, () => service.createDraft({ body: 'ok', linkUrl: 'ftp://example.test/x' })),
    ).rejects.toThrow(/social_invalid.*http/);
  });

  it('refuses to suggest a draft to someone outside the org', async () => {
    await expect(
      inOrg(orgA, () => service.createDraft({ body: 'ok', suggestedUserId: outsider })),
    ).rejects.toThrow(/social_invalid.*not a member/);
  });

  it('re-checks the limit when a draft is revised', async () => {
    const limit = describePlatform('linkedin').limits.maxBodyChars;
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'short' }));
    await expect(
      inOrg(orgA, () => service.reviseDraft(draft.id, 'y'.repeat(limit + 1))),
    ).rejects.toThrow(/social_invalid.*over/);

    const revised = await inOrg(orgA, () => service.reviseDraft(draft.id, 'a better line'));
    expect(revised.body).toBe('a better line');
  });

  it('dismisses one variant without touching the rest of its set', async () => {
    const drafts = await inOrg(orgA, () =>
      service.proposeSet({
        variants: [
          { variantLabel: 'a', body: 'one' },
          { variantLabel: 'b', body: 'two' },
        ],
      }),
    );
    const result = await inOrg(orgA, () => service.dismissDraft(drafts[0]!.id));
    expect(result).toEqual({ dismissed: true, id: drafts[0]!.id });

    const remaining = await inOrg(orgA, () => service.listDrafts({ status: 'pending' }));
    expect(remaining.map((d) => d.id)).toEqual([drafts[1]!.id]);
  });

  it('refuses to decide a draft twice', async () => {
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'once' }));
    await inOrg(orgA, () => service.dismissDraft(draft.id));
    await expect(inOrg(orgA, () => service.dismissDraft(draft.id))).rejects.toThrow(
      /social_conflict.*already dismissed/,
    );
    await expect(inOrg(orgA, () => service.markPosted(draft.id))).rejects.toThrow(
      /social_conflict.*already dismissed/,
    );
  });

  it('records a draft posted by hand, with its permalink', async () => {
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'posted by hand' }));
    const posted = await inOrg(orgA, () => service.markPosted(draft.id, PERMALINK));
    expect(posted.status).toBe('published_externally');
    expect(posted.permalink).toBe(PERMALINK);
    expect(posted.publishedAt).not.toBeNull();
  });

  it('keeps one org out of another org drafts', async () => {
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'private to A' }));
    await expect(inOrg(orgB, () => service.getDraft(draft.id))).rejects.toThrow(
      /social_not_found/,
    );
    expect(await inOrg(orgB, () => service.listDrafts())).toHaveLength(0);
  });

  it('reports a missing draft as not found', async () => {
    await expect(inOrg(orgA, () => service.getDraft('spd_missing'))).rejects.toThrow(
      /social_not_found/,
    );
  });

  it('persists the source reference so the review queue can group by article', async () => {
    const drafts = await inOrg(orgA, () =>
      service.proposeSet({
        sourceRef: { type: 'cms_entry', id: 'cme_42' },
        variants: [{ variantLabel: 'only', body: 'body' }],
      }),
    );
    const stored = await svcDb
      .select()
      .from(schema.socialPostDrafts)
      .where(eq(schema.socialPostDrafts.id, drafts[0]!.id));
    expect(stored[0]!.sourceRef).toEqual({ type: 'cms_entry', id: 'cme_42' });
  });
});
