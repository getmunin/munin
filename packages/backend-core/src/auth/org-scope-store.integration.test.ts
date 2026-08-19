import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, like, eq } from 'drizzle-orm';
import { createDbOrgScopeStore, type OrgScopeStore } from './org-scope-store.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run org-scope store integration tests.';

(skipReason ? describe.skip : describe)('org-scope store', () => {
  const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
  const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbb';
  let db: ReturnType<typeof createDb>;
  let store: OrgScopeStore;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!);
    store = createDbOrgScopeStore(db, 'integration-test-secret-00000000000000');
  });

  afterAll(async () => {
    await db.delete(schema.verifications).where(like(schema.verifications.identifier, 'mcp-org-scope:%'));
  });

  it('recalls the org it remembered for a code challenge', async () => {
    await store.remember('challenge-one', ORG_A);
    await expect(store.recall('challenge-one')).resolves.toBe(ORG_A);
  });

  it('keeps separate challenges on separate orgs', async () => {
    await store.remember('challenge-a', ORG_A);
    await store.remember('challenge-b', ORG_B);
    await expect(store.recall('challenge-a')).resolves.toBe(ORG_A);
    await expect(store.recall('challenge-b')).resolves.toBe(ORG_B);
  });

  it('replaces the org when the same challenge is reused', async () => {
    await store.remember('challenge-reused', ORG_A);
    await store.remember('challenge-reused', ORG_B);
    await expect(store.recall('challenge-reused')).resolves.toBe(ORG_B);
    const rows = await db
      .select({ id: schema.verifications.id })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:challenge-reused'));
    expect(rows).toHaveLength(1);
  });

  it('recalls nothing for an unknown challenge', async () => {
    await expect(store.recall('never-seen')).resolves.toBeNull();
  });

  it('recalls nothing once the association has expired', async () => {
    await db.insert(schema.verifications).values({
      identifier: 'mcp-org-scope:challenge-expired',
      value: ORG_A,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(store.recall('challenge-expired')).resolves.toBeNull();
  });

  it('sweeps expired associations when remembering a new one', async () => {
    await db.insert(schema.verifications).values({
      identifier: 'mcp-org-scope:challenge-stale',
      value: ORG_A,
      expiresAt: new Date(Date.now() - 1000),
    });
    await store.remember('challenge-fresh', ORG_B);
    const stale = await db
      .select({ id: schema.verifications.id })
      .from(schema.verifications)
      .where(eq(schema.verifications.identifier, 'mcp-org-scope:challenge-stale'));
    expect(stale).toHaveLength(0);
  });

  it('refuses to store a value that is not an org id', async () => {
    await store.remember('challenge-bogus', 'not-an-org');
    await expect(store.recall('challenge-bogus')).resolves.toBeNull();
    const rows = await db
      .select({ id: schema.verifications.id })
      .from(schema.verifications)
      .where(
        and(
          like(schema.verifications.identifier, 'mcp-org-scope:%'),
          eq(schema.verifications.identifier, 'mcp-org-scope:challenge-bogus'),
        ),
      );
    expect(rows).toHaveLength(0);
  });
});
