import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, importPKCS8, jwtVerify } from 'jose';
import { encryptSecretSql, setEncryptionKeySql } from '@getmunin/core';
import {
  getOrCreateSigningKey,
  listExternalMcpEndpoints,
  readIdentityClaims,
  readOrgConnectorJwks,
  signIdentityAssertion,
  slugifyConnectionName,
} from './external-mcp.ts';
import { CUSTOM_MCP_VENDOR } from './custom-mcp.adapter.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run external MCP integration tests.';

describe('slugifyConnectionName', () => {
  it('lowercases, collapses separators, and trims underscores', () => {
    expect(slugifyConnectionName('Legacy CRM (prod)')).toBe('legacy_crm_prod');
    expect(slugifyConnectionName('  --  ')).toBe('connection');
    expect(slugifyConnectionName('A'.repeat(60))).toHaveLength(24);
  });
});

(skipReason ? describe.skip : describe)('external MCP identity assertions', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let verifiedEndUserId: string;
  let visitorEndUserId: string;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'External MCP Test Org' })
      .returning();
    orgId = org!.id;
    const [verified] = await db
      .insert(schema.endUsers)
      .values({ orgId, email: 'jane@example.com', phone: '+4712345678', name: 'Jane' })
      .returning();
    verifiedEndUserId = verified!.id;
    const [visitor] = await db
      .insert(schema.endUsers)
      .values({
        orgId,
        email: 'claimed@example.com',
        metadata: { anonymous: true, emailSource: 'visitor' },
      })
      .returning();
    visitorEndUserId = visitor!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  it('mints one signing key per org and is race-idempotent', async () => {
    const [a, b] = await Promise.all([
      getOrCreateSigningKey(appDb, orgId),
      getOrCreateSigningKey(appDb, orgId),
    ]);
    expect(a.kid).toBe(b.kid);
    const again = await getOrCreateSigningKey(appDb, orgId);
    expect(again.kid).toBe(a.kid);
    expect(again.publicJwk.kid).toBe(a.kid);
    expect(again.publicJwk.alg).toBe('ES256');
    expect(again.privateKeyPem).toContain('PRIVATE KEY');
  });

  it('serves the public key as a JWKS document that verifies assertions', async () => {
    const key = await getOrCreateSigningKey(appDb, orgId);
    const jwks = await readOrgConnectorJwks(appDb, orgId);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).not.toHaveProperty('d');

    const claims = await readIdentityClaims(appDb, orgId, verifiedEndUserId, 'chat');
    const privateKey = await importPKCS8(key.privateKeyPem, 'ES256');
    const token = await signIdentityAssertion({
      claims: claims!,
      audience: 'https://crm.example.com/mcp',
      kid: key.kid,
      privateKey,
      ttlSeconds: 60,
    });

    const localJwks = createLocalJWKSet({ keys: jwks.keys });
    const { payload, protectedHeader } = await jwtVerify(token, localJwks, {
      audience: 'https://crm.example.com/mcp',
    });
    expect(protectedHeader.kid).toBe(key.kid);
    expect(payload.sub).toBe(verifiedEndUserId);
    expect(payload.org_id).toBe(orgId);
    expect(payload.email).toBe('jane@example.com');
    expect(payload.email_provenance).toBe('authenticated');
    expect(payload.phone).toBe('+4712345678');
    expect(payload.phone_provenance).toBe('authenticated');
    expect(payload).not.toHaveProperty('email_verified');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('marks visitor-typed identities self_reported regardless of channel', async () => {
    const claims = await readIdentityClaims(appDb, orgId, visitorEndUserId, 'chat');
    expect(claims?.email).toBe('claimed@example.com');
    expect(claims?.provenance).toBe('self_reported');
  });

  it('downgrades an authenticated identity to channel_asserted when the turn arrives over email or sms', async () => {
    for (const channel of ['email', 'sms', 'voice']) {
      const claims = await readIdentityClaims(appDb, orgId, verifiedEndUserId, channel);
      expect(claims?.provenance).toBe('channel_asserted');
    }
  });

  it('defaults to channel_asserted when the channel is unknown', async () => {
    const claims = await readIdentityClaims(appDb, orgId, verifiedEndUserId, null);
    expect(claims?.provenance).toBe('channel_asserted');
  });

  it('lists active custom-mcp connections with decrypted tokens and per-connection assertions', async () => {
    const encrypted = await appDb.transaction(async (tx) => {
      await tx.execute(setEncryptionKeySql());
      const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
        sql`SELECT ${encryptSecretSql('secret_token_123')} AS ct`,
      );
      return rows[0]!.ct;
    });

    await db.insert(schema.connectorConnections).values([
      {
        orgId,
        vendor: CUSTOM_MCP_VENDOR,
        domain: 'mcp',
        name: 'Legacy CRM',
        config: {
          url: 'https://crm.example.com/mcp',
          encryptedBearerToken: encrypted,
          allowedTools: ['list_subscriptions'],
        },
        active: true,
        credentialState: 'active',
      },
      {
        orgId,
        vendor: CUSTOM_MCP_VENDOR,
        domain: 'mcp',
        name: 'Inactive CRM',
        config: {
          url: 'https://other.example.com/mcp',
          encryptedBearerToken: encrypted,
          allowedTools: ['list_subscriptions'],
        },
        active: false,
        credentialState: 'active',
      },
      {
        orgId,
        vendor: CUSTOM_MCP_VENDOR,
        domain: 'mcp',
        name: 'Pending CRM',
        config: { url: 'https://pending.example.com/mcp' },
        active: false,
        credentialState: 'pending',
      },
    ]);

    const endpoints = await listExternalMcpEndpoints(appDb, {
      orgId,
      endUserId: verifiedEndUserId,
    });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.slug).toBe('legacy_crm');
    expect(endpoints[0]!.url).toBe('https://crm.example.com/mcp');
    expect(endpoints[0]!.bearerToken).toBe('secret_token_123');
    expect(endpoints[0]!.identityAssertion.split('.')).toHaveLength(3);

    await db.insert(schema.connectorConnections).values({
      orgId,
      vendor: CUSTOM_MCP_VENDOR,
      domain: 'mcp',
      name: 'Legacy CRM!',
      config: {
        url: 'https://crm2.example.com/mcp',
        encryptedBearerToken: encrypted,
        allowedTools: ['list_subscriptions'],
      },
      active: true,
      credentialState: 'active',
    });
    const withCollision = await listExternalMcpEndpoints(appDb, {
      orgId,
      endUserId: verifiedEndUserId,
    });
    expect(withCollision.map((e) => e.slug).sort()).toEqual(['legacy_crm', 'legacy_crm_2']);
  });

  it('skips a connected server that has no allow-listed tools, so a misconnected admin MCP reaches no customer', async () => {
    const encrypted = await appDb.transaction(async (tx) => {
      await tx.execute(setEncryptionKeySql());
      const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
        sql`SELECT ${encryptSecretSql('secret_token_456')} AS ct`,
      );
      return rows[0]!.ct;
    });
    await db.insert(schema.connectorConnections).values({
      orgId,
      vendor: CUSTOM_MCP_VENDOR,
      domain: 'mcp',
      name: 'Internal admin MCP',
      config: { url: 'https://internal.example.com/mcp', encryptedBearerToken: encrypted },
      active: true,
      credentialState: 'active',
    });

    const endpoints = await listExternalMcpEndpoints(appDb, {
      orgId,
      endUserId: verifiedEndUserId,
    });
    expect(endpoints.map((e) => e.url)).not.toContain('https://internal.example.com/mcp');
  });

  it('returns nothing for an unknown end user', async () => {
    const endpoints = await listExternalMcpEndpoints(appDb, {
      orgId,
      endUserId: 'eu_does_not_exist',
    });
    expect(endpoints).toEqual([]);
  });
});
