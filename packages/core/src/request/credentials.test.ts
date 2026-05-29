import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import type { Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { CredentialResolver } from './credentials.ts';
import { buildApiKey, keyPrefix } from '../crypto/keys.ts';
import { hashSecret } from '../crypto/primitives.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run credential resolver tests.';

(skipReason ? describe.skip : describe)('CredentialResolver.resolveApiKey', () => {
  let db: Db;
  let orgId: string;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Credential Resolver Test Org' })
      .returning();
    orgId = org!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      void db.$client.end();
    }
  });

  beforeEach(async () => {
    await db.delete(schema.apiKeys).where(sql`org_id = ${orgId}`);
  });

  async function insertKey(args: {
    type: string;
    rawKey?: string;
    scopes?: string[];
    audiences?: string[];
    revoked?: boolean;
  }): Promise<string> {
    const rawKey = args.rawKey ?? buildApiKey(args.type === 'widget' ? 'widget' : 'admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: args.type,
      name: `${args.type} key`,
      keyHash: hashSecret(rawKey),
      keyPrefix: keyPrefix(rawKey),
      scopes: args.scopes ?? (args.type === 'widget' ? ['conv:widget:write'] : ['*']),
      audiences: args.audiences ?? ['admin'],
      revokedAt: args.revoked ? new Date() : null,
    });
    return rawKey;
  }

  it('resolves an admin key as admin_agent', async () => {
    const raw = await insertKey({ type: 'admin', scopes: ['kb:read'] });
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(raw);
    expect(out).not.toBeNull();
    expect(out!.actor.type).toBe('admin_agent');
    expect(out!.actor.scopes).toEqual(['kb:read']);
    expect(out!.actor.orgId).toBe(orgId);
  });

  it('resolves a widget key as widget_agent', async () => {
    const raw = await insertKey({ type: 'widget' });
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(raw);
    expect(out).not.toBeNull();
    expect(out!.actor.type).toBe('widget_agent');
    expect(out!.actor.orgId).toBe(orgId);
  });

  it('forces widget audience to self_service even if the row says admin', async () => {
    const raw = await insertKey({ type: 'widget', audiences: ['admin'] });
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(raw);
    expect(out!.actor.audiences).toEqual(['self_service']);
    expect(out!.actor.hasAudience('admin')).toBe(false);
  });

  it('narrows tampered widget scopes to the widget allowlist', async () => {
    const raw = await insertKey({
      type: 'widget',
      scopes: ['*', 'cms:write', 'conv:widget:write', 'kb:read'],
    });
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(raw);
    expect(out!.actor.scopes).toEqual(['conv:widget:write']);
    expect(out!.actor.hasScope('cms:write')).toBe(false);
    expect(out!.actor.hasScope('*')).toBe(false);
  });

  it('returns null for an unknown api_keys.type', async () => {
    const raw = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'mystery',
      name: 'mystery key',
      keyHash: hashSecret(raw),
      keyPrefix: keyPrefix(raw),
      scopes: ['*'],
    });
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(raw);
    expect(out).toBeNull();
  });

  it('returns null for a revoked key', async () => {
    const raw = await insertKey({ type: 'admin', revoked: true });
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(raw);
    expect(out).toBeNull();
  });

  it('returns null when the prefix matches but the hash does not', async () => {
    const raw = await insertKey({ type: 'admin' });
    const forged = `${raw.slice(0, 8)}${'x'.repeat(raw.length - 8)}`;
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(forged);
    expect(out).toBeNull();
  });

  it('ActorIdentity does not carry the raw key or hash', async () => {
    const raw = await insertKey({ type: 'admin' });
    const r = new CredentialResolver(db);
    const out = await r.resolveApiKey(raw);
    const json = JSON.stringify(out);
    expect(json).not.toContain(raw);
    expect(json).not.toContain(hashSecret(raw));
  });
});
