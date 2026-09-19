import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SocialMediaError } from './social-media.ts';
import { SocialAssetUsageProvider } from './social-asset-usage.provider.ts';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { SocialService } from './social.service.ts';
import { describePlatform } from './social-platform.ts';
import { socialDraftFingerprint } from './social-fingerprint.ts';
import {
  DbRootTransactionRunner,
  StubEventEmitter,
  StubPublisherLookup,
  StubTokenSource,
  UnusedTransactionRunner,
  StubMediaReader,
} from './social-test-doubles.ts';

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
  const emitter = new StubEventEmitter();
  const service = new SocialService(
    new StubTokenSource(),
    new StubPublisherLookup(),
    new UnusedTransactionRunner(),
    emitter,
    new StubMediaReader(),
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
    function buildService(
      publisher: StubPublisherLookup,
      token = new StubTokenSource(),
      events: StubEventEmitter = new StubEventEmitter(),
    ) {
      return new SocialService(
        token,
        publisher,
        new DbRootTransactionRunner(svcDb),
        events,
        new StubMediaReader(),
      );
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

    async function connectAccount(
      orgId: string,
      userId: string,
      status = 'active',
      extra: { platform?: string; authorKind?: string; displayName?: string } = {},
    ) {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await svcDb.insert(schema.socialAccounts).values({
        orgId,
        userId,
        platform: extra.platform ?? 'linkedin',
        authorKind: extra.authorKind ?? 'member',
        externalAccountId: `ext-${randomUUID()}`,
        displayName: extra.displayName ?? 'Ola Nordmann',
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
        result: {
          externalPostId: 'urn:li:share:9',
          permalink: 'https://example.test/p/9',
          commentExternalId: null,
          commentError: null,
        },
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

    it('announces the published post so bridges can resolve their own cards', async () => {
      await connectAccount(orgA, member);
      const events = new StubEventEmitter();
      const svc = buildService(new StubPublisherLookup(), new StubTokenSource(), events);
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));

      await asUser(orgA, member, () => svc.publishDraft(draft.id));

      expect(events.typesFor(draft.id)).toEqual(['social.post_draft.published']);
      expect(events.emitted[0]!.payload).toMatchObject({
        status: 'published',
        publishedExternally: false,
        platform: 'linkedin',
      });
    });

    it('announces a platform refusal, from the transaction that recorded it', async () => {
      await connectAccount(orgA, member);
      const events = new StubEventEmitter();
      const svc = buildService(
        new StubPublisherLookup({ error: new Error('LinkedIn refused the post (422)') }),
        new StubTokenSource(),
        events,
      );
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));

      await expect(asUser(orgA, member, () => svc.publishDraft(draft.id))).rejects.toMatchObject({
        response: { code: 'social_publish_failed' },
      });

      expect(events.typesFor(draft.id)).toEqual(['social.post_draft.failed']);
      expect(events.emitted[0]!.payload).toMatchObject({ status: 'failed' });
      expect(String(events.emitted[0]!.payload.reason)).toContain('422');
    });

    it('refuses a fingerprint that no longer matches the body it was taken from', async () => {
      await connectAccount(orgA, member);
      const publisher = new StubPublisherLookup();
      const svc = buildService(publisher);
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'First wording' }));
      const stale = socialDraftFingerprint({
        platform: draft.platform,
        body: draft.body,
        linkUrl: draft.linkUrl,
      });
      await inOrg(orgA, () => service.reviseDraft(draft.id, 'Second wording'));

      await expect(
        asUser(orgA, member, () => svc.publishDraft(draft.id, { fingerprint: stale })),
      ).rejects.toMatchObject({ response: { code: 'social_stale' } });
      expect(publisher.requests).toHaveLength(0);
      expect((await readDraft(draft.id)).status).toBe('pending');
    });

    it('accepts a fingerprint taken from the current body', async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup());
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Steady wording' }));

      const published = await asUser(orgA, member, () =>
        svc.publishDraft(draft.id, {
          fingerprint: socialDraftFingerprint({
            platform: draft.platform,
            body: draft.body,
            linkUrl: draft.linkUrl,
          }),
        }),
      );
      expect(published.status).toBe('published');
    });

    it('dismisses the rest of the set, because a set is one post written several ways', async () => {
      await connectAccount(orgA, member);
      const events = new StubEventEmitter();
      const svc = buildService(new StubPublisherLookup(), new StubTokenSource(), events);
      const drafts = await inOrg(orgA, () =>
        service.proposeSet({
          variants: [
            { variantLabel: 'a', body: 'Take one' },
            { variantLabel: 'b', body: 'Take two' },
            { variantLabel: 'c', body: 'Take three' },
          ],
        }),
      );

      await asUser(orgA, member, () => svc.publishDraft(drafts[0]!.id));

      const rest = await Promise.all(drafts.slice(1).map((d) => readDraft(d.id)));
      expect(rest.map((r) => r.status)).toEqual(['dismissed', 'dismissed']);
      expect(rest[0]!.dismissReason).toContain('variant a was published instead');
      expect(rest[0]!.decidedAt).toBeTruthy();
      expect(events.emitted.map((e) => e.type)).toEqual([
        'social.post_draft.published',
        'social.post_draft.dismissed',
        'social.post_draft.dismissed',
      ]);
      expect(events.emitted[1]!.payload).toMatchObject({ supersededBy: drafts[0]!.id });
    });

    it('leaves the set alone when the platform refused the post', async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup({ error: new Error('refused (422)') }));
      const drafts = await inOrg(orgA, () =>
        service.proposeSet({
          variants: [
            { variantLabel: 'a', body: 'Take one' },
            { variantLabel: 'b', body: 'Take two' },
          ],
        }),
      );

      await expect(
        asUser(orgA, member, () => svc.publishDraft(drafts[0]!.id)),
      ).rejects.toMatchObject({ response: { code: 'social_publish_failed' } });

      expect((await readDraft(drafts[1]!.id)).status).toBe('pending');
    });

    it('does not reach across sets', async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup());
      const mine = await inOrg(orgA, () => service.createDraft({ body: 'Mine' }));
      const other = await inOrg(orgA, () => service.createDraft({ body: 'Someone else' }));

      await asUser(orgA, member, () => svc.publishDraft(mine.id));

      expect((await readDraft(other.id)).status).toBe('pending');
    });

    it("reports the viewer's own connected accounts, and nobody else's", async () => {
      await connectAccount(orgA, member);
      const svc = buildService(new StubPublisherLookup());

      const mine = await asUser(orgA, member, () => svc.publishTargetsForViewer());
      expect(mine).toHaveLength(1);
      expect(mine[0]!.userId).toBe(member);
      expect(mine[0]!.displayName).toBe('Ola Nordmann');

      const theirs = await asUser(orgA, outsider, () => svc.publishTargetsForViewer());
      expect(theirs).toEqual([]);
    });

    it('reports each platform separately, so a page draft is never signed with a profile name', async () => {
      await connectAccount(orgA, member);
      await connectAccount(orgA, member, 'active', {
        platform: 'facebook',
        authorKind: 'org_page',
        displayName: 'Acme',
      });
      const svc = buildService(new StubPublisherLookup());

      const mine = await asUser(orgA, member, () => svc.publishTargetsForViewer());
      const byPlatform = Object.fromEntries(mine.map((t) => [t.platform, t]));
      expect(byPlatform['linkedin']!.authorKind).toBe('member');
      expect(byPlatform['linkedin']!.displayName).toBe('Ola Nordmann');
      expect(byPlatform['facebook']!.authorKind).toBe('org_page');
      expect(byPlatform['facebook']!.displayName).toBe('Acme');
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

  it('re-checks the limit when a draft is revised', async () => {
    const limit = describePlatform('linkedin').limits.maxBodyChars;
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'short' }));
    await expect(
      inOrg(orgA, () => service.reviseDraft(draft.id, 'y'.repeat(limit + 1))),
    ).rejects.toThrow(/social_invalid.*over/);

    const revised = await inOrg(orgA, () => service.reviseDraft(draft.id, 'a better line'));
    expect(revised.body).toBe('a better line');
  });

  it('settles the rest of the set when one variant is marked posted by hand', async () => {
    const drafts = await inOrg(orgA, () =>
      service.proposeSet({
        variants: [
          { variantLabel: 'a', body: 'Take one' },
          { variantLabel: 'b', body: 'Take two' },
        ],
      }),
    );

    await inOrg(orgA, () => service.markPosted(drafts[0]!.id, 'https://example.test/p/2'));

    const sibling = await inOrg(orgA, () => service.listDrafts({ setId: drafts[0]!.setId }));
    expect(sibling.find((d) => d.id === drafts[1]!.id)!.status).toBe('dismissed');
    expect(emitter.typesFor(drafts[1]!.id)).toEqual([
      'social.post_draft.proposed',
      'social.post_draft.dismissed',
    ]);
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

  it('announces every step of a draft life so a bridge can keep its card in step', async () => {
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'First wording' }));
    await inOrg(orgA, () => service.reviseDraft(draft.id, 'Second wording'));
    await inOrg(orgA, () => service.markPosted(draft.id, 'https://example.test/p/1'));

    expect(emitter.typesFor(draft.id)).toEqual([
      'social.post_draft.proposed',
      'social.post_draft.revised',
      'social.post_draft.published',
    ]);
    const posted = emitter.emitted.at(-1)!;
    expect(posted.payload).toMatchObject({
      status: 'published_externally',
      publishedExternally: true,
      permalink: 'https://example.test/p/1',
    });
  });

  it('announces a dismissal with the reason given for it', async () => {
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));
    await inOrg(orgA, () => service.dismissDraft(draft.id, 'off message'));

    expect(emitter.typesFor(draft.id)).toEqual([
      'social.post_draft.proposed',
      'social.post_draft.dismissed',
    ]);
    expect(emitter.emitted.at(-1)!.payload).toMatchObject({
      status: 'dismissed',
      reason: 'off message',
    });
  });

  it('announces one proposal per variant in a set', async () => {
    const drafts = await inOrg(orgA, () =>
      service.proposeSet({
        variants: [
          { variantLabel: 'a', body: 'Take one' },
          { variantLabel: 'b', body: 'Take two' },
        ],
      }),
    );

    for (const draft of drafts) {
      expect(emitter.typesFor(draft.id)).toEqual(['social.post_draft.proposed']);
    }
  });

  it('keeps one org out of another org drafts', async () => {
    const draft = await inOrg(orgA, () => service.createDraft({ body: 'private to A' }));
    await expect(inOrg(orgB, () => service.getDraft(draft.id))).rejects.toThrow(
      /social_not_found/,
    );
    expect(await inOrg(orgB, () => service.listDrafts())).toHaveLength(0);
  });

  describe('media and link placement', () => {
    function buildService(publisher: StubPublisherLookup, media: StubMediaReader) {
      return new SocialService(
        new StubTokenSource(),
        publisher,
        new DbRootTransactionRunner(svcDb),
        new StubEventEmitter(),
        media,
      );
    }

    async function readStoredDraft(id: string) {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const [row] = await svcDb
        .select()
        .from(schema.socialPostDrafts)
        .where(eq(schema.socialPostDrafts.id, id));
      return row!;
    }

    async function asMember<T>(
      fn: (svc: SocialService) => Promise<T>,
      publisher: StubPublisherLookup,
      media: StubMediaReader = new StubMediaReader(),
    ) {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await svcDb.delete(schema.socialAccounts);
      await svcDb.insert(schema.socialAccounts).values({
        orgId: orgA,
        userId: member,
        platform: 'linkedin',
        externalAccountId: 'ext-media',
        displayName: 'Ola Nordmann',
        encryptedAccessToken: 'ciphertext',
        scopes: ['w_member_social'],
        status: 'active',
      });
      const actor = new ActorIdentity(
        'user',
        member,
        orgA,
        ['*'],
        ['admin'],
        undefined,
        undefined,
        undefined,
        member,
      );
      return await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.org_id', ${orgA}, true)`);
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        return await withContext(ctx, () => fn(buildService(publisher, media)));
      });
    }

    it('stores the media and placement a draft was proposed with', async () => {
      const draft = await inOrg(orgA, () =>
        service.createDraft({
          body: 'Worth sharing.',
          linkUrl: ARTICLE,
          linkPlacement: 'comment',
          linkCommentText: 'Full write-up:',
          mediaUrl: 'https://example.test/card.png',
          mediaKind: 'image',
          mediaAltText: 'A chart',
        }),
      );
      expect(draft.linkPlacement).toBe('comment');
      expect(draft.linkCommentText).toBe('Full write-up:');
      expect(draft.mediaUrl).toBe('https://example.test/card.png');
      expect(draft.mediaKind).toBe('image');
      expect(draft.mediaAltText).toBe('A chart');
    });

    it('refuses a comment placement with no link to put in the comment', async () => {
      await expect(
        inOrg(orgA, () => service.createDraft({ body: 'Body', linkPlacement: 'comment' })),
      ).rejects.toThrow(/needs a linkUrl/);
    });

    it('refuses comment wording on a draft whose link stays in the body', async () => {
      await expect(
        inOrg(orgA, () =>
          service.createDraft({ body: 'Body', linkUrl: ARTICLE, linkCommentText: 'Here:' }),
        ),
      ).rejects.toThrow(/only applies when linkPlacement is comment/);
    });

    it('refuses alt text with no media to describe', async () => {
      await expect(
        inOrg(orgA, () => service.createDraft({ body: 'Body', mediaAltText: 'A chart' })),
      ).rejects.toThrow(/need a mediaUrl/);
    });

    it('leaves a link out of the body count when it is going in a comment', async () => {
      const long = 'x'.repeat(2990);
      const inBody = inOrg(orgA, () =>
        service.createDraft({ body: long, linkUrl: ARTICLE, variantLabel: 'body' }),
      );
      await expect(inBody).resolves.toBeTruthy();
      const draft = await inOrg(orgA, () =>
        service.createDraft({
          body: long,
          linkUrl: ARTICLE,
          linkPlacement: 'comment',
          variantLabel: 'comment',
        }),
      );
      expect(draft.bodyChars).toBe(long.length);
    });

    it('refuses a comment placement when the body already carries the same link', async () => {
      await expect(
        inOrg(orgA, () =>
          service.createDraft({
            body: `Worth reading: ${ARTICLE}`,
            linkUrl: ARTICLE,
            linkPlacement: 'comment',
          }),
        ),
      ).rejects.toThrow(/would publish it twice/);
    });

    it('refuses to move a link into a comment when the body already spells it out', async () => {
      await svcDb.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const [seeded] = await svcDb
        .insert(schema.socialPostDrafts)
        .values({
          orgId: orgA,
          platform: 'linkedin',
          setId: 'set_legacy',
          variantLabel: 'single',
          body: `Worth reading: ${ARTICLE}`,
          linkUrl: ARTICLE,
          proposedByActorType: 'user',
          proposedByActorId: member,
        })
        .returning();

      await expect(
        inOrg(orgA, () =>
          service.setDraftLinkPlacement(seeded!.id, { linkPlacement: 'comment' }),
        ),
      ).rejects.toThrow(/would publish it twice/);
    });

    it('rejects a body that carries the link inline at the moment it is filed', async () => {
      await expect(
        inOrg(orgA, () =>
          service.createDraft({ body: `Worth reading: ${ARTICLE}`, linkUrl: ARTICLE }),
        ),
      ).rejects.toThrow(/carries 2 links/);
    });

    it('refuses a revision that pastes the link back into a comment-placed draft', async () => {
      const draft = await inOrg(orgA, () =>
        service.createDraft({ body: 'Worth reading.', linkUrl: ARTICLE, linkPlacement: 'comment' }),
      );
      await expect(
        inOrg(orgA, () => service.reviseDraft(draft.id, `Worth reading: ${ARTICLE}`)),
      ).rejects.toThrow(/would publish it twice/);
      await expect(
        inOrg(orgA, () => service.reviseDraft(draft.id, 'Worth reading. Link in the comments.')),
      ).resolves.toBeTruthy();
    });

    it('attaches the media a draft carries and passes its placement through to the platform', async () => {
      const publisher = new StubPublisherLookup();
      const draft = await inOrg(orgA, () =>
        service.createDraft({
          body: 'Worth sharing.',
          linkUrl: ARTICLE,
          linkPlacement: 'comment',
          mediaUrl: 'https://example.test/card.png',
          mediaKind: 'image',
          mediaAltText: 'A chart',
        }),
      );

      const media = new StubMediaReader();
      await asMember((svc) => svc.publishDraft(draft.id), publisher, media);

      expect(media.media).toEqual(['https://example.test/card.png']);
      expect(publisher.uploads).toHaveLength(1);
      expect(publisher.uploads[0]!.kind).toBe('image');
      expect(publisher.uploads[0]!.altText).toBe('A chart');
      expect(publisher.requests[0]!.linkPlacement).toBe('comment');
      expect(publisher.requests[0]!.media).toMatchObject({ kind: 'image', id: 'urn:li:image:1' });
    });

    it('fails the publish when media the draft names cannot be fetched, rather than posting without it', async () => {
      const publisher = new StubPublisherLookup();
      const draft = await inOrg(orgA, () =>
        service.createDraft({
          body: 'Worth sharing.',
          mediaUrl: 'https://example.test/card.png',
        }),
      );

      const media = new StubMediaReader({
        media: new SocialMediaError('https://example.test/card.png answered 404'),
      });
      await expect(
        asMember((svc) => svc.publishDraft(draft.id), publisher, media),
      ).rejects.toMatchObject({ response: { code: 'social_media_failed' } });
      expect(publisher.requests).toHaveLength(0);
      const stored = await readStoredDraft(draft.id);
      expect(stored.status).toBe('pending');
    });

    it('publishes without a picture when the linked page advertises none', async () => {
      const publisher = new StubPublisherLookup();
      const draft = await inOrg(orgA, () =>
        service.createDraft({ body: 'Worth sharing.', linkUrl: ARTICLE }),
      );

      const media = new StubMediaReader({
        preview: { title: 'No card', description: null, imageUrl: null },
      });
      await asMember((svc) => svc.publishDraft(draft.id), publisher, media);

      expect(media.pages).toHaveLength(1);
      expect(publisher.uploads).toHaveLength(0);
      expect(publisher.requests[0]!.media).toBeNull();
      expect((await readStoredDraft(draft.id)).status).toBe('published');
    });

    it('records a refused comment on the published draft instead of failing the post', async () => {
      const publisher = new StubPublisherLookup({
        result: {
          externalPostId: 'urn:li:share:9',
          permalink: 'https://example.test/p/9',
          commentExternalId: null,
          commentError: 'LinkedIn refused the comment (403): ACCESS_DENIED',
        },
      });
      const draft = await inOrg(orgA, () =>
        service.createDraft({ body: 'Body', linkUrl: ARTICLE, linkPlacement: 'comment' }),
      );

      const published = await asMember((svc) => svc.publishDraft(draft.id), publisher);

      expect(published.status).toBe('published');
      expect(published.commentError).toMatch(/403/);
      expect(published.commentExternalId).toBeNull();
      expect((await readStoredDraft(draft.id)).commentError).toMatch(/403/);
    });

    it('moves the link between body and comment on a pending draft', async () => {
      const draft = await inOrg(orgA, () =>
        service.createDraft({ body: 'Body', linkUrl: ARTICLE }),
      );
      const moved = await inOrg(orgA, () =>
        service.setDraftLinkPlacement(draft.id, {
          linkPlacement: 'comment',
          linkCommentText: 'Here:',
        }),
      );
      expect(moved.linkPlacement).toBe('comment');
      expect(moved.linkCommentText).toBe('Here:');
      expect(socialDraftFingerprint(await readStoredDraft(draft.id))).not.toBe(
        socialDraftFingerprint({ platform: 'linkedin', body: draft.body, linkUrl: draft.linkUrl }),
      );
    });

    it('sets and clears the media on a pending draft', async () => {
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));
      const withMedia = await inOrg(orgA, () =>
        service.setDraftMedia(draft.id, {
          mediaUrl: 'https://example.test/clip.mp4',
          mediaKind: 'video',
          mediaAltText: null,
        }),
      );
      expect(withMedia.mediaUrl).toBe('https://example.test/clip.mp4');
      expect(withMedia.mediaKind).toBe('video');

      const cleared = await inOrg(orgA, () =>
        service.setDraftMedia(draft.id, { mediaUrl: null }),
      );
      expect(cleared.mediaUrl).toBeNull();
      expect(cleared.mediaKind).toBeNull();
    });

    it('reports a pending draft as a user of the asset it points at, so the CMS will not delete it', async () => {
      const provider = new SocialAssetUsageProvider();
      const url = 'https://cdn.example.test/assets/card.png';
      const draft = await inOrg(orgA, () =>
        service.createDraft({ body: 'Body', mediaUrl: url }),
      );

      const inUse = await inOrg(orgA, () =>
        provider.usageFor({ assetId: 'cma_1', publicUrl: url }),
      );
      expect(inUse).toEqual([
        { kind: 'social_draft', id: draft.id, description: `pending linkedin post draft ${draft.id}` },
      ]);

      const otherAsset = await inOrg(orgA, () =>
        provider.usageFor({ assetId: 'cma_2', publicUrl: 'https://cdn.example.test/other.png' }),
      );
      expect(otherAsset).toEqual([]);

      const fromAnotherOrg = await inOrg(orgB, () =>
        provider.usageFor({ assetId: 'cma_1', publicUrl: url }),
      );
      expect(fromAnotherOrg).toEqual([]);
    });

    it('stops holding an asset once the draft is decided, so cleanup is free to remove it', async () => {
      const provider = new SocialAssetUsageProvider();
      const url = 'https://cdn.example.test/assets/spent.png';
      const draft = await inOrg(orgA, () =>
        service.createDraft({ body: 'Body', mediaUrl: url }),
      );
      await inOrg(orgA, () => service.dismissDraft(draft.id, 'not using it'));

      expect(await inOrg(orgA, () => provider.usageFor({ assetId: 'cma_1', publicUrl: url }))).toEqual(
        [],
      );
    });

    it('refuses to change media on a draft that has already been decided', async () => {
      const draft = await inOrg(orgA, () => service.createDraft({ body: 'Body' }));
      await inOrg(orgA, () => service.dismissDraft(draft.id, 'no'));
      await expect(
        inOrg(orgA, () =>
          service.setDraftMedia(draft.id, { mediaUrl: 'https://example.test/a.png' }),
        ),
      ).rejects.toThrow(/already dismissed/);
    });
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
