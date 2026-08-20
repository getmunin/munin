import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, like, eq } from 'drizzle-orm';
import {
  createDbOrgScopeStore,
  type OrgScopeAssociationKeys,
  type OrgScopeStore,
} from './org-scope-store.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run org-scope store integration tests.';

(skipReason ? describe.skip : describe)('org-scope store', () => {
  const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
  const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbb';
  let db: ReturnType<typeof createDb>;
  let store: OrgScopeStore;

  const keys = (session: string | null, challenge: string | null): OrgScopeAssociationKeys => ({
    session,
    challenge,
  });

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!);
    store = createDbOrgScopeStore(db, 'integration-test-secret-00000000000000');
  });

  afterAll(async () => {
    await db
      .delete(schema.verifications)
      .where(like(schema.verifications.identifier, 'mcp-org-scope:%'));
  });

  it('recalls the org it remembered for a session', async () => {
    await store.remember(keys('session-one', 'challenge-one'), ORG_A);
    await expect(store.recall(keys('session-one', 'challenge-one'))).resolves.toEqual({ orgId: ORG_A, basePath: '/mcp' });
  });

  it('recalls an association written before the browser had a session', async () => {
    await store.remember(keys(null, 'challenge-anonymous'), ORG_A);
    await expect(store.recall(keys('session-new', 'challenge-anonymous'))).resolves.toEqual({ orgId: ORG_A, basePath: '/mcp' });
  });

  it('keeps separate challenges on separate orgs', async () => {
    await store.remember(keys('session-a', 'challenge-a'), ORG_A);
    await store.remember(keys('session-b', 'challenge-b'), ORG_B);
    await expect(store.recall(keys('session-a', 'challenge-a'))).resolves.toEqual({ orgId: ORG_A, basePath: '/mcp' });
    await expect(store.recall(keys('session-b', 'challenge-b'))).resolves.toEqual({ orgId: ORG_B, basePath: '/mcp' });
  });

  it('replaces the org when the same session reuses a challenge', async () => {
    await store.remember(keys('session-reused', 'challenge-reused'), ORG_A);
    await store.remember(keys('session-reused', 'challenge-reused'), ORG_B);
    await expect(store.recall(keys('session-reused', null))).resolves.toEqual({ orgId: ORG_B, basePath: '/mcp' });
    const rows = await db
      .select({ id: schema.verifications.id })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:session-reused'));
    expect(rows).toHaveLength(1);
  });

  it('will not let a later request repoint a challenge another request already claimed', async () => {
    await store.remember(keys('session-first', 'challenge-contested'), ORG_A);
    await store.remember(keys('session-second', 'challenge-contested'), ORG_B);
    await expect(store.recall(keys(null, 'challenge-contested'))).resolves.toEqual({ orgId: ORG_A, basePath: '/mcp' });
  });

  it('prefers the association the recalling session started', async () => {
    await store.remember(keys(null, 'challenge-both'), ORG_B);
    await store.remember(keys('session-both', 'challenge-both'), ORG_A);
    await expect(store.recall(keys('session-both', 'challenge-both'))).resolves.toEqual({ orgId: ORG_A, basePath: '/mcp' });
    await expect(store.recall(keys('session-unrelated', 'challenge-both'))).resolves.toEqual({ orgId: ORG_B, basePath: '/mcp' });
  });

  it('round-trips the resource the org was asked for', async () => {
    await store.remember(keys('session-surface', 'challenge-surface'), ORG_A, '/mcp/media');
    await expect(store.recall(keys('session-surface', 'challenge-surface'))).resolves.toEqual({
      orgId: ORG_A,
      basePath: '/mcp/media',
    });
  });

  it('reads a row written before associations carried a resource as the shared endpoint', async () => {
    await db.insert(schema.verifications).values({
      identifier: 'mcp-org-scope:challenge-legacy',
      value: ORG_A,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(store.recall(keys(null, 'challenge-legacy'))).resolves.toEqual({
      orgId: ORG_A,
      basePath: '/mcp',
    });
  });

  it('refuses a base path outside the MCP tree', async () => {
    await store.remember(keys('session-outside', 'challenge-outside'), ORG_A, '/v1/orgs');
    await expect(store.recall(keys('session-outside', 'challenge-outside'))).resolves.toBeNull();
  });

  it('recalls nothing for an unknown challenge', async () => {
    await expect(store.recall(keys('never-seen', 'never-seen-either'))).resolves.toBeNull();
  });

  it('outlives the authorization request it belongs to', async () => {
    await store.remember(keys('session-window', 'challenge-window'), ORG_A);
    const rows = await db
      .select({ expiresAt: schema.verifications.expiresAt })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:session-window'));
    const remainingMs = rows[0]!.expiresAt.getTime() - Date.now();
    expect(remainingMs).toBeGreaterThan(600_000);
  });

  it('pushes the expiry out on every recall, so a re-signed request cannot outlast it', async () => {
    await store.remember(keys('session-sliding', 'challenge-sliding'), ORG_A);
    const expiryOf = async (identifier: string) => {
      const rows = await db
        .select({ expiresAt: schema.verifications.expiresAt })
        .from(schema.verifications)
        .where(eq(schema.verifications.identifier, identifier));
      return rows[0]!.expiresAt.getTime();
    };
    await db
      .update(schema.verifications)
      .set({ expiresAt: new Date(Date.now() + 30_000) })
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:session-sliding'));
    const before = await expiryOf('mcp-org-scope:session-sliding');
    await expect(store.recall(keys('session-sliding', 'challenge-sliding'))).resolves.toEqual({ orgId: ORG_A, basePath: '/mcp' });
    expect(await expiryOf('mcp-org-scope:session-sliding')).toBeGreaterThan(before);
  });

  it('pushes out the challenge-keyed expiry when that is the one that answered', async () => {
    await store.remember(keys(null, 'challenge-sliding-anon'), ORG_A);
    await db
      .update(schema.verifications)
      .set({ expiresAt: new Date(Date.now() + 30_000) })
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:challenge-sliding-anon'));
    const rowsBefore = await db
      .select({ expiresAt: schema.verifications.expiresAt })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:challenge-sliding-anon'));
    await expect(store.recall(keys('session-absent', 'challenge-sliding-anon'))).resolves.toEqual({
      orgId: ORG_A,
      basePath: '/mcp',
    });
    const rowsAfter = await db
      .select({ expiresAt: schema.verifications.expiresAt })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:challenge-sliding-anon'));
    expect(rowsAfter[0]!.expiresAt.getTime()).toBeGreaterThan(rowsBefore[0]!.expiresAt.getTime());
  });

  it('does not resurrect an association that already expired', async () => {
    await db.insert(schema.verifications).values({
      identifier: 'mcp-org-scope:challenge-gone',
      value: ORG_A,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(store.recall(keys(null, 'challenge-gone'))).resolves.toBeNull();
    const rows = await db
      .select({ expiresAt: schema.verifications.expiresAt })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:challenge-gone'));
    expect(rows[0]!.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it('recalls nothing once the association has expired', async () => {
    await db.insert(schema.verifications).values({
      identifier: 'mcp-org-scope:challenge-expired',
      value: ORG_A,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(store.recall(keys(null, 'challenge-expired'))).resolves.toBeNull();
  });

  it('sweeps expired associations when remembering a new one', async () => {
    await db.insert(schema.verifications).values({
      identifier: 'mcp-org-scope:challenge-stale',
      value: ORG_A,
      expiresAt: new Date(Date.now() - 1000),
    });
    await store.remember(keys('session-fresh', 'challenge-fresh'), ORG_B);
    const stale = await db
      .select({ id: schema.verifications.id })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:challenge-stale'));
    expect(stale).toHaveLength(0);
  });

  it('refuses to store a value that is not an org id', async () => {
    await store.remember(keys('session-bogus', 'challenge-bogus'), 'not-an-org');
    await expect(store.recall(keys('session-bogus', 'challenge-bogus'))).resolves.toBeNull();
    const rows = await db
      .select({ id: schema.verifications.id })
      .from(schema.verifications)
      .where(
        and(
          like(schema.verifications.identifier, 'mcp-org-scope:%'),
          eq(schema.verifications.identifier, 'mcp-org-scope:session-bogus'),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it('derives no keys without a challenge, and a session key only with a session cookie', () => {
    const secret = 'integration-test-secret-00000000000000';
    const cookie = 'better-auth.session_token=abc.signature';
    const derived = createDbOrgScopeStore(db, secret);
    expect(derived.keysFor(cookie, undefined)).toEqual({ session: null, challenge: null });
    expect(derived.keysFor(undefined, 'a-challenge').session).toBeNull();
    expect(derived.keysFor(undefined, 'a-challenge').challenge).toBeTruthy();
    expect(derived.keysFor(cookie, 'a-challenge').session).toBeTruthy();
  });
});
