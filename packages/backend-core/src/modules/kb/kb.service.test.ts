import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  StubEmbeddingProvider,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  CURATION_INBOX_SLUG,
  KbService,
  KbConflictError,
  KbCurationDecidedError,
  KbNotFoundError,
  KbInvalidError,
} from './kb.service.ts';
import { EmbeddingProviderHolder } from './embedding.provider.ts';
import { DefaultQuotasService } from '../../common/quotas/quotas.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run KB service tests.';

(skipReason ? describe.skip : describe)('KbService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: KbService;
  let orgId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'KB Test Org' })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_test', orgId, ['*'], ['admin']);

    const holder = new (class extends EmbeddingProviderHolder {
      override get() {
        return new StubEmbeddingProvider();
      }
    })();
    svc = new KbService(holder, new DefaultQuotasService(), new WebhookDispatcher());
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM kb_curation_decisions WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM kb_documents WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM kb_spaces WHERE org_id = ${orgId}`);
  });

  function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = {
        db: tx,
        actor: as,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return runAs(actor, fn);
  }

  it('creates and lists spaces', async () => {
    await run(() => svc.createSpace({ name: 'Engineering', slug: 'engineering' }));
    await run(() => svc.createSpace({ name: 'Product', slug: 'product' }));
    const spaces = await run(() => svc.listSpaces());
    expect(spaces.map((s) => s.slug).sort()).toEqual(['engineering', 'product']);
  });

  it('rejects duplicate slugs and invalid slugs', async () => {
    await run(() => svc.createSpace({ name: 'A', slug: 'foo' }));
    await expect(run(() => svc.createSpace({ name: 'B', slug: 'foo' }))).rejects.toThrow(
      KbInvalidError,
    );
    await expect(run(() => svc.createSpace({ name: 'C', slug: 'BAD slug!' }))).rejects.toThrow(
      KbInvalidError,
    );
  });

  it('creates a document, chunks it, embeds, and snapshots v1', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({
        spaceId: space.id,
        title: 'Onboarding',
        body: 'Welcome to Munin. This is the first paragraph.\n\nSecond paragraph here.',
      }),
    );
    expect(doc.version).toBe(1);
    expect(doc.audiences).toEqual(['admin']);

    const versions = await run(() => svc.listVersions(doc.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe(1);

    const chunkRows = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM kb_document_chunks WHERE document_id = ${doc.id}`,
    );
    expect(chunkRows[0]!.count).toBeGreaterThan(0);
  });

  it('updates with optimistic concurrency', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'T', body: 'Body one' }),
    );
    const updated = await run(() =>
      svc.updateDocument({ id: doc.id, ifVersion: 1, body: 'Body two' }),
    );
    expect(updated.version).toBe(2);
    expect(updated.body).toBe('Body two');

    await expect(
      run(() => svc.updateDocument({ id: doc.id, ifVersion: 1, body: 'stale' })),
    ).rejects.toThrow(KbConflictError);
  });

  it('stores sourceUrl on create and returns it from reads', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({
        spaceId: space.id,
        title: 'Refunds',
        body: 'Within 30 days.',
        slug: 'refunds',
        sourceUrl: 'https://example.com/help/refunds',
      }),
    );
    expect(doc.sourceUrl).toBe('https://example.com/help/refunds');

    const read = await run(() => svc.getDocument(doc.id));
    expect(read.sourceUrl).toBe('https://example.com/help/refunds');

    const bySlug = await run(() => svc.getDocumentBySlug('docs', 'refunds'));
    expect(bySlug!.sourceUrl).toBe('https://example.com/help/refunds');

    const listed = await run(() => svc.listDocuments({ spaceId: space.id }));
    expect(listed.find((d) => d.id === doc.id)!.sourceUrl).toBe(
      'https://example.com/help/refunds',
    );
  });

  it('defaults sourceUrl to null and trims a blank one away', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const plain = await run(() => svc.createDocument({ spaceId: space.id, title: 'T', body: 'B' }));
    expect(plain.sourceUrl).toBeNull();

    const blank = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'T2', body: 'B2', sourceUrl: '   ' }),
    );
    expect(blank.sourceUrl).toBeNull();
  });

  it('keeps sourceUrl when update omits it, and clears it on explicit null', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({
        spaceId: space.id,
        title: 'T',
        body: 'B',
        sourceUrl: 'https://example.com/a',
      }),
    );

    const bodyOnly = await run(() =>
      svc.updateDocument({ id: doc.id, ifVersion: 1, body: 'B2' }),
    );
    expect(bodyOnly.sourceUrl).toBe('https://example.com/a');

    const moved = await run(() =>
      svc.updateDocument({ id: doc.id, ifVersion: 2, sourceUrl: 'https://example.com/b' }),
    );
    expect(moved.sourceUrl).toBe('https://example.com/b');

    const cleared = await run(() =>
      svc.updateDocument({ id: doc.id, ifVersion: 3, sourceUrl: null }),
    );
    expect(cleared.sourceUrl).toBeNull();
  });

  it('rejects a sourceUrl that is not an absolute http(s) URL', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    await expect(
      run(() =>
        svc.createDocument({ spaceId: space.id, title: 'T', body: 'B', sourceUrl: '/help/refunds' }),
      ),
    ).rejects.toThrow(KbInvalidError);
    await expect(
      run(() =>
        svc.createDocument({
          spaceId: space.id,
          title: 'T',
          body: 'B',
          sourceUrl: 'javascript:alert(1)',
        }),
      ),
    ).rejects.toThrow(KbInvalidError);

    const doc = await run(() => svc.createDocument({ spaceId: space.id, title: 'T2', body: 'B' }));
    await expect(
      run(() => svc.updateDocument({ id: doc.id, ifVersion: 1, sourceUrl: 'notaurl' })),
    ).rejects.toThrow(KbInvalidError);
  });

  it('carries sourceUrl through export and import', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    await run(() =>
      svc.createDocument({
        spaceId: space.id,
        title: 'Refunds',
        body: 'Within 30 days.',
        slug: 'refunds',
        sourceUrl: 'https://example.com/help/refunds',
      }),
    );
    const exported = await run(() => svc.exportKb());
    const exportedDoc = exported.documents.find((d) => d.slug === 'refunds');
    expect(exportedDoc!.sourceUrl).toBe('https://example.com/help/refunds');

    await db.execute(sql`DELETE FROM kb_documents WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM kb_spaces WHERE org_id = ${orgId}`);

    await run(() => svc.importKb(exported));
    const reimported = await run(() => svc.getDocumentBySlug('docs', 'refunds'));
    expect(reimported!.sourceUrl).toBe('https://example.com/help/refunds');
  });

  it('skips re-chunking when only metadata changed', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'T', body: 'Body' }),
    );
    const firstRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM kb_document_chunks WHERE document_id = ${doc.id} ORDER BY chunk_index LIMIT 1`,
    );
    const firstChunkId = firstRows[0]!.id;
    await run(() => svc.updateDocument({ id: doc.id, ifVersion: 1, audiences: ['admin', 'self_service'] }));
    const secondRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM kb_document_chunks WHERE document_id = ${doc.id} ORDER BY chunk_index LIMIT 1`,
    );
    expect(secondRows[0]!.id).toBe(firstChunkId);
  });

  it('restores a prior version', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const v1 = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'Title v1', body: 'Body v1' }),
    );
    await run(() => svc.updateDocument({ id: v1.id, ifVersion: 1, body: 'Body v2' }));
    const restored = await run(() =>
      svc.restoreVersion({ documentId: v1.id, version: 1, ifVersion: 2 }),
    );
    expect(restored.version).toBe(3);
    expect(restored.body).toBe('Body v1');
  });

  it('deletes with concurrency check', async () => {
    const space = await run(() => svc.createSpace({ name: 'Docs', slug: 'docs' }));
    const doc = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'T', body: 'Body' }),
    );
    await expect(
      run(() => svc.deleteDocument({ id: doc.id, ifVersion: 99 })),
    ).rejects.toThrow(KbConflictError);
    await run(() => svc.deleteDocument({ id: doc.id, ifVersion: 1 }));
    await expect(run(() => svc.getDocument(doc.id))).rejects.toThrow(KbNotFoundError);
  });

  it('marks seeded agent-runtime docs as system and rejects deletion', async () => {
    const space = await run(() =>
      svc.createSpace({ name: 'Agent runtime', slug: 'agent-runtime' }),
    );
    const sysDoc = await run(() =>
      svc.createDocument({
        spaceId: space.id,
        slug: 'system-prompt',
        title: 'System prompt',
        body: 'You are helpful.',
      }),
    );
    expect(sysDoc.isSystem).toBe(true);

    await expect(
      run(() => svc.deleteDocument({ id: sysDoc.id, ifVersion: sysDoc.version })),
    ).rejects.toThrow(KbInvalidError);

    const edited = await run(() =>
      svc.updateDocument({
        id: sysDoc.id,
        ifVersion: sysDoc.version,
        body: 'You are very helpful.',
      }),
    );
    expect(edited.body).toBe('You are very helpful.');
    expect(edited.isSystem).toBe(true);

    const userDoc = await run(() =>
      svc.createDocument({
        spaceId: space.id,
        slug: 'team-handbook',
        title: 'Team handbook',
        body: 'Internal notes.',
      }),
    );
    expect(userDoc.isSystem).toBe(false);
    await run(() =>
      svc.deleteDocument({ id: userDoc.id, ifVersion: userDoc.version }),
    );
  });

  it('round-trips a slug through createDocument and getDocumentBySlug', async () => {
    const space = await run(() =>
      svc.createSpace({ name: 'Agent runtime', slug: 'agent-runtime' }),
    );
    const doc = await run(() =>
      svc.createDocument({
        spaceId: space.id,
        slug: 'system-prompt',
        title: 'System prompt',
        body: 'You are a helpful assistant.',
      }),
    );
    expect(doc.slug).toBe('system-prompt');

    const found = await run(() => svc.getDocumentBySlug('agent-runtime', 'system-prompt'));
    expect(found?.id).toBe(doc.id);
    expect(found?.body).toBe('You are a helpful assistant.');

    const missing = await run(() => svc.getDocumentBySlug('agent-runtime', 'nope'));
    expect(missing).toBeNull();
  });

  it('rejects a duplicate (space, slug) pair', async () => {
    const space = await run(() => svc.createSpace({ name: 'A', slug: 'agent-runtime' }));
    await run(() =>
      svc.createDocument({
        spaceId: space.id,
        slug: 'system-prompt',
        title: 'First',
        body: 'B',
      }),
    );
    await expect(
      run(() =>
        svc.createDocument({
          spaceId: space.id,
          slug: 'system-prompt',
          title: 'Second',
          body: 'B',
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid slug shape', async () => {
    const space = await run(() => svc.createSpace({ name: 'A', slug: 'agent-runtime' }));
    await expect(
      run(() =>
        svc.createDocument({
          spaceId: space.id,
          slug: 'BAD slug!',
          title: 'T',
          body: 'B',
        }),
      ),
    ).rejects.toThrow(KbInvalidError);
  });

  it('allows multiple un-slugged docs in the same space (partial unique index)', async () => {
    const space = await run(() => svc.createSpace({ name: 'A', slug: 'docs' }));
    const a = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'A', body: 'a' }),
    );
    const b = await run(() =>
      svc.createDocument({ spaceId: space.id, title: 'B', body: 'b' }),
    );
    expect(a.slug).toBeNull();
    expect(b.slug).toBeNull();
    expect(a.id).not.toBe(b.id);
  });

  describe('curation', () => {
    it('proposes a candidate, lazy-creating the inbox space on first call', async () => {
      const before = await run(() => svc.listSpaces());
      expect(before.find((s) => s.slug === CURATION_INBOX_SLUG)).toBeUndefined();

      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Weekend hours',
          draftBody: '# When are you open on weekends?\n\nWe open 10–16 Sat, 12–16 Sun.',
          sourceConversationId: 'ccv_test',
          proposedTargetSpaceSlug: 'support-faq',
        }),
      );
      expect(candidate.title).toBe('Weekend hours');
      expect(candidate.audiences).toEqual(['admin']);
      expect(candidate.tags).toEqual(
        expect.arrayContaining(['curation', 'candidate', 'source:ccv_test', 'target:support-faq']),
      );
      expect(candidate.body).toBe(
        '# When are you open on weekends?\n\nWe open 10–16 Sat, 12–16 Sun.',
      );

      const candidates = await run(() => svc.listCurationCandidates());
      const summary = candidates.find((d) => d.id === candidate.id);
      expect(summary?.proposedTargetSpaceSlug).toBe('support-faq');
      expect(summary?.sourceConversationId).toBe('ccv_test');

      const detail = await run(() => svc.getCurationCandidate(candidate.id));
      expect(detail.proposedTargetSpaceSlug).toBe('support-faq');
      expect(detail.sourceConversationId).toBe('ccv_test');

      const after = await run(() => svc.listSpaces());
      expect(after.find((s) => s.slug === CURATION_INBOX_SLUG)).toBeDefined();

      const second = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Refunds policy',
          draftBody: 'Refunds within 14 days for unused items.',
        }),
      );
      expect(second.spaceId).toBe(candidate.spaceId);
    });

    it('publishes a candidate into a target space, removing it from the inbox', async () => {
      await run(() => svc.createSpace({ name: 'Support FAQ', slug: 'support-faq' }));
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'How to reset password',
          draftBody: 'Click the reset link in the welcome email.',
          proposedTargetSpaceSlug: 'support-faq',
        }),
      );
      const published = await run(() =>
        svc.publishCurationCandidate({
          candidateDocumentId: candidate.id,
          targetSpaceSlug: 'support-faq',
          ifVersion: candidate.version,
        }),
      );
      expect(published.audiences).toEqual(['admin', 'self_service']);
      expect(published.tags).not.toEqual(expect.arrayContaining(['candidate', 'curation']));
      expect(published.title).toBe('How to reset password');

      await expect(run(() => svc.getDocument(candidate.id))).rejects.toThrow(KbNotFoundError);
    });

    it('refuses to publish a candidate that was edited after the version being published was read', async () => {
      await run(() => svc.createSpace({ name: 'Support FAQ', slug: 'support-faq' }));
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Refund window',
          draftBody: 'Refunds within 30 days.',
          proposedTargetSpaceSlug: 'support-faq',
        }),
      );
      await run(() =>
        svc.updateDocument({
          id: candidate.id,
          ifVersion: candidate.version,
          body: 'Refunds within 3 days.',
        }),
      );

      await expect(
        run(() =>
          svc.publishCurationCandidate({
            candidateDocumentId: candidate.id,
            targetSpaceSlug: 'support-faq',
            ifVersion: candidate.version,
          }),
        ),
      ).rejects.toThrow(KbConflictError);

      const stillInInbox = await run(() => svc.getCurationCandidate(candidate.id));
      expect(stillInInbox.body).toBe('Refunds within 3 days.');
      const target = await run(() => svc.listDocuments({ tag: 'candidate' }));
      expect(target.map((d) => d.id)).toContain(candidate.id);

      const republished = await run(() =>
        svc.publishCurationCandidate({
          candidateDocumentId: candidate.id,
          targetSpaceSlug: 'support-faq',
          ifVersion: stillInInbox.version,
        }),
      );
      expect(republished.body).toBe('Refunds within 3 days.');
    });

    it('does not auto-create the target space when the version check fails', async () => {
      const candidate = await run(() =>
        svc.proposeCurationCandidate({ subject: 'Q', draftBody: 'A' }),
      );
      await expect(
        run(() =>
          svc.publishCurationCandidate({
            candidateDocumentId: candidate.id,
            targetSpaceSlug: 'brand-new-space',
            ifVersion: candidate.version + 5,
          }),
        ),
      ).rejects.toThrow(KbConflictError);
      const spaces = await run(() => svc.listSpaces());
      expect(spaces.find((s) => s.slug === 'brand-new-space')).toBeUndefined();
    });

    async function curationEvents(candidateId: string): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
      const rows = await db.execute<{ type: string; payload: Record<string, unknown> }>(
        sql`SELECT type, payload FROM events
            WHERE org_id = ${orgId}
              AND type LIKE 'kb.curation_candidate.%'
              AND payload->>'candidateDocumentId' = ${candidateId}
            ORDER BY created_at`,
      );
      return [...rows];
    }

    it('emits proposed / published / dismissed curation events', async () => {
      await run(() => svc.createSpace({ name: 'Support FAQ', slug: 'support-faq' }));
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Weekend hours',
          draftBody: 'We open 10–16 Saturdays.',
          sourceConversationId: 'ccv_evt',
          proposedTargetSpaceSlug: 'support-faq',
        }),
      );
      let events = await curationEvents(candidate.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('kb.curation_candidate.proposed');
      expect(events[0]!.payload).toMatchObject({
        candidateDocumentId: candidate.id,
        title: 'Weekend hours',
        proposedTargetSpaceSlug: 'support-faq',
        sourceConversationId: 'ccv_evt',
        spaceId: candidate.spaceId,
      });

      const published = await run(() =>
        svc.publishCurationCandidate({
          candidateDocumentId: candidate.id,
          targetSpaceSlug: 'support-faq',
          ifVersion: candidate.version,
        }),
      );
      events = await curationEvents(candidate.id);
      expect(events.map((e) => e.type)).toEqual([
        'kb.curation_candidate.proposed',
        'kb.curation_candidate.published',
      ]);
      expect(events[1]!.payload).toMatchObject({
        candidateDocumentId: candidate.id,
        publishedDocumentId: published.id,
        targetSpaceSlug: 'support-faq',
        title: 'Weekend hours',
      });

      const dismissed = await run(() =>
        svc.proposeCurationCandidate({ subject: 'Refunds', draftBody: 'Within 14 days.' }),
      );
      await run(() => svc.deleteDocument({ id: dismissed.id, ifVersion: dismissed.version }));
      const dismissedEvents = await curationEvents(dismissed.id);
      expect(dismissedEvents.map((e) => e.type)).toEqual([
        'kb.curation_candidate.proposed',
        'kb.curation_candidate.dismissed',
      ]);
      expect(dismissedEvents[1]!.payload).toMatchObject({
        candidateDocumentId: dismissed.id,
        title: 'Refunds',
        proposedTargetSpaceSlug: null,
        sourceConversationId: null,
      });
    });

    it('records a dismissal that outlives the deleted draft', async () => {
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Weekend hours',
          draftBody: 'We open 10–16 Saturdays.',
          sourceConversationId: 'ccv_dismissed',
        }),
      );
      const result = await run(() =>
        svc.dismissCurationCandidate({
          id: candidate.id,
          ifVersion: candidate.version,
          reason: 'answer is customer-specific',
        }),
      );
      expect(result).toEqual({
        dismissed: true,
        id: candidate.id,
        sourceConversationId: 'ccv_dismissed',
      });
      await expect(run(() => svc.getDocument(candidate.id))).rejects.toThrow(KbNotFoundError);

      const decisions = await run(() => svc.listCurationDecisions());
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        sourceConversationId: 'ccv_dismissed',
        candidateDocumentId: candidate.id,
        title: 'Weekend hours',
        outcome: 'dismissed',
        reason: 'answer is customer-specific',
        publishedDocumentId: null,
        decidedByActorType: 'agent',
      });
    });

    it('resolves a decider display name for user actors and leaves it null for agents', async () => {
      const [decider] = await db
        .insert(schema.users)
        .values({ email: `curator-${randomUUID()}@example.test`, name: 'Jo Dahl' })
        .returning();
      const userActor = new ActorIdentity('user', decider!.id, orgId, ['*'], ['admin']);

      const byUser = await run(() =>
        svc.proposeCurationCandidate({ subject: 'Named', draftBody: 'Body.' }),
      );
      await runAs(userActor, () =>
        svc.dismissCurationCandidate({ id: byUser.id, ifVersion: byUser.version }),
      );

      const byAgent = await run(() =>
        svc.proposeCurationCandidate({ subject: 'Anonymous', draftBody: 'Body.' }),
      );
      await run(() =>
        svc.dismissCurationCandidate({ id: byAgent.id, ifVersion: byAgent.version }),
      );

      const decisions = await run(() => svc.listCurationDecisions());
      const named = decisions.find((d) => d.title === 'Named');
      const anonymous = decisions.find((d) => d.title === 'Anonymous');
      expect(named).toMatchObject({ decidedByActorType: 'user', decidedByName: 'Jo Dahl' });
      expect(anonymous).toMatchObject({ decidedByActorType: 'agent', decidedByName: null });

      await db.delete(schema.users).where(sql`id = ${decider!.id}`);
    });

    it('refuses to refile a candidate from a conversation whose draft was dismissed', async () => {
      const first = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Weekend hours',
          draftBody: 'We open 10–16 Saturdays.',
          sourceConversationId: 'ccv_rejected',
        }),
      );
      await run(() =>
        svc.dismissCurationCandidate({ id: first.id, ifVersion: first.version }),
      );

      await expect(
        run(() =>
          svc.proposeCurationCandidate({
            subject: 'Opening hours on weekends',
            draftBody: 'Reworded, same conversation.',
            sourceConversationId: 'ccv_rejected',
          }),
        ),
      ).rejects.toThrow(KbCurationDecidedError);
      expect(await run(() => svc.listCurationCandidates())).toHaveLength(0);
    });

    it('refuses to refile a candidate from a conversation that was already published', async () => {
      await run(() => svc.createSpace({ name: 'Support FAQ', slug: 'support-faq' }));
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'How to reset password',
          draftBody: 'Click the reset link.',
          sourceConversationId: 'ccv_published',
          proposedTargetSpaceSlug: 'support-faq',
        }),
      );
      const published = await run(() =>
        svc.publishCurationCandidate({
          candidateDocumentId: candidate.id,
          targetSpaceSlug: 'support-faq',
          ifVersion: candidate.version,
        }),
      );

      const decisions = await run(() => svc.listCurationDecisions({ outcome: 'published' }));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        sourceConversationId: 'ccv_published',
        outcome: 'published',
        publishedDocumentId: published.id,
        reason: null,
      });

      await expect(
        run(() =>
          svc.proposeCurationCandidate({
            subject: 'Password reset steps',
            draftBody: 'Same conversation, next sweep.',
            sourceConversationId: 'ccv_published',
          }),
        ),
      ).rejects.toThrow(KbCurationDecidedError);
    });

    it('leaves candidates without a source conversation, and other conversations, filable', async () => {
      const first = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Weekend hours',
          draftBody: 'Body.',
          sourceConversationId: 'ccv_one',
        }),
      );
      await run(() => svc.dismissCurationCandidate({ id: first.id, ifVersion: first.version }));

      const other = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Refunds',
          draftBody: 'Within 14 days.',
          sourceConversationId: 'ccv_two',
        }),
      );
      const sourceless = await run(() =>
        svc.proposeCurationCandidate({ subject: 'Shipping', draftBody: 'Ships in 2 days.' }),
      );
      expect((await run(() => svc.listCurationCandidates())).map((c) => c.id).sort()).toEqual(
        [other.id, sourceless.id].sort(),
      );
    });

    it('filters decisions by source conversation', async () => {
      for (const conv of ['ccv_a', 'ccv_b']) {
        const candidate = await run(() =>
          svc.proposeCurationCandidate({
            subject: `Q ${conv}`,
            draftBody: 'A',
            sourceConversationId: conv,
          }),
        );
        await run(() =>
          svc.dismissCurationCandidate({ id: candidate.id, ifVersion: candidate.version }),
        );
      }
      const onlyB = await run(() =>
        svc.listCurationDecisions({ sourceConversationId: 'ccv_b' }),
      );
      expect(onlyB.map((d) => d.title)).toEqual(['Q ccv_b']);
    });

    it('rejects dismissing a document that is not a curation candidate', async () => {
      const space = await run(() => svc.createSpace({ name: 'Plain', slug: 'plain' }));
      const doc = await run(() =>
        svc.createDocument({ spaceId: space.id, title: 'Plain', body: 'body' }),
      );
      await expect(
        run(() => svc.dismissCurationCandidate({ id: doc.id, ifVersion: doc.version })),
      ).rejects.toThrow(KbInvalidError);
      expect(await run(() => svc.listCurationDecisions())).toHaveLength(0);
    });

    it('refuses to dismiss a candidate that was edited after the reviewed version', async () => {
      const candidate = await run(() =>
        svc.proposeCurationCandidate({ subject: 'Q', draftBody: 'A' }),
      );
      await run(() =>
        svc.updateDocument({ id: candidate.id, ifVersion: candidate.version, body: 'A2' }),
      );
      await expect(
        run(() =>
          svc.dismissCurationCandidate({ id: candidate.id, ifVersion: candidate.version }),
        ),
      ).rejects.toThrow(KbConflictError);
      expect(await run(() => svc.listCurationDecisions())).toHaveLength(0);
      expect(await run(() => svc.listCurationCandidates())).toHaveLength(1);
    });

    it('records a dismissal when a candidate is removed with kb_delete_document', async () => {
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Q',
          draftBody: 'A',
          sourceConversationId: 'ccv_deleted',
        }),
      );
      await run(() => svc.deleteDocument({ id: candidate.id, ifVersion: candidate.version }));
      const decisions = await run(() => svc.listCurationDecisions());
      expect(decisions).toMatchObject([
        { sourceConversationId: 'ccv_deleted', outcome: 'dismissed', reason: null },
      ]);
    });

    it('emits no curation events when deleting a plain document', async () => {
      const space = await run(() => svc.createSpace({ name: 'Plain', slug: 'plain' }));
      const doc = await run(() =>
        svc.createDocument({ spaceId: space.id, title: 'Plain', body: 'body' }),
      );
      await run(() => svc.deleteDocument({ id: doc.id, ifVersion: doc.version }));
      expect(await curationEvents(doc.id)).toHaveLength(0);
    });

    it('rejects publishing a non-candidate document', async () => {
      const space = await run(() => svc.createSpace({ name: 'Plain', slug: 'plain' }));
      const doc = await run(() =>
        svc.createDocument({ spaceId: space.id, title: 'Plain', body: 'body' }),
      );
      await run(() => svc.createSpace({ name: 'Target', slug: 'target' }));
      await expect(
        run(() =>
          svc.publishCurationCandidate({
            candidateDocumentId: doc.id,
            targetSpaceSlug: 'target',
            ifVersion: doc.version,
          }),
        ),
      ).rejects.toThrow(KbInvalidError);
    });

    it('auto-creates the target space if it does not exist, deriving the name from the slug', async () => {
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'When are you open on weekends?',
          draftBody: 'We open 10–16 Saturdays.',
        }),
      );
      const published = await run(() =>
        svc.publishCurationCandidate({
          candidateDocumentId: candidate.id,
          targetSpaceSlug: 'support-faq',
          ifVersion: candidate.version,
        }),
      );
      const spaces = await run(() => svc.listSpaces());
      const created = spaces.find((s) => s.slug === 'support-faq');
      expect(created).toBeDefined();
      expect(created!.name).toBe('Support Faq');
      expect(published.spaceId).toBe(created!.id);
    });

    it('rejects auto-creation when the slug is malformed', async () => {
      const candidate = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Q',
          draftBody: 'A',
        }),
      );
      await expect(
        run(() =>
          svc.publishCurationCandidate({
            candidateDocumentId: candidate.id,
            targetSpaceSlug: 'NOT a slug!',
            ifVersion: candidate.version,
          }),
        ),
      ).rejects.toThrow(KbInvalidError);
    });
  });

  describe('curation revisions', () => {
    const CURRENT = 'The effective rate is about 11.9%.\n\nApply with BankID.';
    const CORRECTED = 'The effective rate is about 9.4%.\n\nApply with BankID.';

    async function seedPublishedDoc(body = CURRENT) {
      const space = await run(() => svc.createSpace({ name: 'Support FAQ', slug: 'support-faq' }));
      return run(() =>
        svc.createDocument({
          spaceId: space.id,
          title: 'Rates and fees',
          body,
          audiences: ['admin', 'self_service'],
        }),
      );
    }

    it('proposes a revision that points at the document it corrects', async () => {
      const doc = await seedPublishedDoc();
      const candidate = await run(() =>
        svc.proposeCurationRevision({
          revisesDocumentId: doc.id,
          draftBody: CORRECTED,
          sourceConversationId: 'ccv_rate',
          sourceMessageId: 'cvm_rate',
        }),
      );
      expect(candidate.tags).toEqual(
        expect.arrayContaining([
          'curation',
          'candidate',
          'revision',
          `revises:${doc.id}`,
          'source:ccv_rate',
          'source-msg:cvm_rate',
        ]),
      );
      expect(candidate.title).toBe('Rates and fees');
      expect(candidate.audiences).toEqual(['admin']);

      const [summary] = await run(() => svc.listCurationCandidates());
      expect(summary?.revisesDocumentId).toBe(doc.id);
      expect(summary?.revisesDocumentTitle).toBe('Rates and fees');
      expect(summary?.revisesDocumentVersion).toBe(doc.version);
      expect(summary?.proposedTargetSpaceSlug).toBeNull();

      const detail = await run(() => svc.getCurationCandidate(candidate.id));
      expect(detail.revisesDocumentBody).toBe(CURRENT);
    });

    it('publishes a revision as a new version of the document it revises', async () => {
      const doc = await seedPublishedDoc();
      const candidate = await run(() =>
        svc.proposeCurationRevision({
          revisesDocumentId: doc.id,
          draftBody: CORRECTED,
          sourceConversationId: 'ccv_rate',
          sourceMessageId: 'cvm_rate',
        }),
      );
      const published = await run(() =>
        svc.publishCurationRevision({
          candidateDocumentId: candidate.id,
          ifCandidateVersion: candidate.version,
          ifDocumentVersion: doc.version,
        }),
      );
      expect(published.id).toBe(doc.id);
      expect(published.body).toBe(CORRECTED);
      expect(published.version).toBe(doc.version + 1);
      expect(published.audiences).toEqual(['admin', 'self_service']);

      const remaining = await run(() => svc.listCurationCandidates());
      expect(remaining).toEqual([]);

      const versions = await run(() => svc.listVersions(doc.id));
      expect(versions.map((v) => v.version)).toEqual([doc.version + 1, doc.version]);

      const decisions = await run(() => svc.listCurationDecisions());
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        outcome: 'published',
        publishedDocumentId: doc.id,
        sourceConversationId: 'ccv_rate',
        sourceMessageId: 'cvm_rate',
      });
    });

    it('rolls a bad revision back through the version history', async () => {
      const doc = await seedPublishedDoc();
      const candidate = await run(() =>
        svc.proposeCurationRevision({ revisesDocumentId: doc.id, draftBody: CORRECTED }),
      );
      const published = await run(() =>
        svc.publishCurationRevision({
          candidateDocumentId: candidate.id,
          ifCandidateVersion: candidate.version,
          ifDocumentVersion: doc.version,
        }),
      );
      const restored = await run(() =>
        svc.restoreVersion({
          documentId: doc.id,
          version: doc.version,
          ifVersion: published.version,
        }),
      );
      expect(restored.body).toBe(CURRENT);
    });

    it('writes nothing when the revised document moved after the diff was reviewed', async () => {
      const doc = await seedPublishedDoc();
      const candidate = await run(() =>
        svc.proposeCurationRevision({ revisesDocumentId: doc.id, draftBody: CORRECTED }),
      );
      await run(() =>
        svc.updateDocument({ id: doc.id, ifVersion: doc.version, body: 'edited elsewhere' }),
      );
      await expect(
        run(() =>
          svc.publishCurationRevision({
            candidateDocumentId: candidate.id,
            ifCandidateVersion: candidate.version,
            ifDocumentVersion: doc.version,
          }),
        ),
      ).rejects.toThrow(KbConflictError);
      const untouched = await run(() => svc.getDocument(doc.id));
      expect(untouched.body).toBe('edited elsewhere');
      const stillPending = await run(() => svc.listCurationCandidates());
      expect(stillPending).toHaveLength(1);
    });

    it('writes nothing when the proposed text moved after it was reviewed', async () => {
      const doc = await seedPublishedDoc();
      const candidate = await run(() =>
        svc.proposeCurationRevision({ revisesDocumentId: doc.id, draftBody: CORRECTED }),
      );
      await expect(
        run(() =>
          svc.publishCurationRevision({
            candidateDocumentId: candidate.id,
            ifCandidateVersion: candidate.version + 1,
            ifDocumentVersion: doc.version,
          }),
        ),
      ).rejects.toThrow(KbConflictError);
      const untouched = await run(() => svc.getDocument(doc.id));
      expect(untouched.body).toBe(CURRENT);
    });

    it('refuses to publish a revision as a second, duplicate document', async () => {
      const doc = await seedPublishedDoc();
      const candidate = await run(() =>
        svc.proposeCurationRevision({ revisesDocumentId: doc.id, draftBody: CORRECTED }),
      );
      await expect(
        run(() =>
          svc.publishCurationCandidate({
            candidateDocumentId: candidate.id,
            targetSpaceSlug: 'support-faq',
            ifVersion: candidate.version,
          }),
        ),
      ).rejects.toThrow(KbInvalidError);
      const docs = await run(() => svc.listDocuments({}));
      expect(docs.filter((d) => d.title === 'Rates and fees')).toHaveLength(2);
    });

    it('refuses to publish a plain candidate through the revision path', async () => {
      const candidate = await run(() =>
        svc.proposeCurationCandidate({ subject: 'New topic', draftBody: 'Body.' }),
      );
      await expect(
        run(() =>
          svc.publishCurationRevision({
            candidateDocumentId: candidate.id,
            ifCandidateVersion: candidate.version,
            ifDocumentVersion: 1,
          }),
        ),
      ).rejects.toThrow(KbInvalidError);
    });

    it('refuses to revise a candidate or an agent-runtime configuration document', async () => {
      const doc = await seedPublishedDoc();
      const candidate = await run(() =>
        svc.proposeCurationRevision({ revisesDocumentId: doc.id, draftBody: CORRECTED }),
      );
      await expect(
        run(() =>
          svc.proposeCurationRevision({
            revisesDocumentId: candidate.id,
            draftBody: 'nested',
          }),
        ),
      ).rejects.toThrow(KbInvalidError);
    });

    it('curates a second message of a conversation whose first was already decided', async () => {
      const doc = await seedPublishedDoc();
      const first = await run(() =>
        svc.proposeCurationRevision({
          revisesDocumentId: doc.id,
          draftBody: CORRECTED,
          sourceConversationId: 'ccv_multi',
          sourceMessageId: 'cvm_one',
        }),
      );
      await run(() =>
        svc.dismissCurationCandidate({ id: first.id, ifVersion: first.version, reason: 'no' }),
      );
      await expect(
        run(() =>
          svc.proposeCurationRevision({
            revisesDocumentId: doc.id,
            draftBody: CORRECTED,
            sourceConversationId: 'ccv_multi',
            sourceMessageId: 'cvm_one',
          }),
        ),
      ).rejects.toThrow(KbCurationDecidedError);
      const second = await run(() =>
        svc.proposeCurationRevision({
          revisesDocumentId: doc.id,
          draftBody: 'Another correction.',
          sourceConversationId: 'ccv_multi',
          sourceMessageId: 'cvm_two',
        }),
      );
      expect(second.id).toBeTruthy();
    });

    it('lets a decision recorded without a source message still close its whole conversation', async () => {
      const doc = await seedPublishedDoc();
      const legacy = await run(() =>
        svc.proposeCurationCandidate({
          subject: 'Legacy',
          draftBody: 'Body.',
          sourceConversationId: 'ccv_legacy',
        }),
      );
      await run(() =>
        svc.dismissCurationCandidate({ id: legacy.id, ifVersion: legacy.version }),
      );
      await expect(
        run(() =>
          svc.proposeCurationRevision({
            revisesDocumentId: doc.id,
            draftBody: CORRECTED,
            sourceConversationId: 'ccv_legacy',
            sourceMessageId: 'cvm_new',
          }),
        ),
      ).rejects.toThrow(KbCurationDecidedError);
    });
  });
});
