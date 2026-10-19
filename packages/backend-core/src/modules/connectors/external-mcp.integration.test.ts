import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, importPKCS8, jwtVerify } from 'jose';
import { encryptSecretSql } from '@getmunin/core';
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
      .values({
        orgId,
        email: 'jane@example.com',
        phone: '+4712345678',
        name: 'Jane',
        metadata: { emailSource: 'org-attested' },
      })
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

    const claims = await readIdentityClaims(appDb, {
      orgId,
      endUserId: verifiedEndUserId,
      conversationId: null,
      channelType: 'chat',
    });
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
    const claims = await readIdentityClaims(appDb, {
      orgId,
      endUserId: visitorEndUserId,
      conversationId: null,
      channelType: 'chat',
    });
    expect(claims?.email).toBe('claimed@example.com');
    expect(claims?.provenance).toBe('self_reported');
  });

  it('downgrades an authenticated identity to channel_asserted when the turn arrives over email or sms', async () => {
    for (const channel of ['email', 'sms', 'voice']) {
      const claims = await readIdentityClaims(appDb, {
        orgId,
        endUserId: verifiedEndUserId,
        conversationId: null,
        channelType: channel,
      });
      expect(claims?.provenance).toBe('channel_asserted');
    }
  });

  it('defaults to channel_asserted when the channel is unknown', async () => {
    const claims = await readIdentityClaims(appDb, {
      orgId,
      endUserId: verifiedEndUserId,
      conversationId: null,
      channelType: null,
    });
    expect(claims?.provenance).toBe('channel_asserted');
  });

  it('lists active custom-mcp connections with decrypted tokens and per-connection assertions', async () => {
    const encrypted = await appDb.transaction(async (tx) => {
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
      conversationId: null,
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
      conversationId: null,
    });
    expect(withCollision.map((e) => e.slug).sort()).toEqual(['legacy_crm', 'legacy_crm_2']);
  });

  it('skips a connected server that has no allow-listed tools, so a misconnected admin MCP reaches no customer', async () => {
    const encrypted = await appDb.transaction(async (tx) => {
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
      conversationId: null,
    });
    expect(endpoints.map((e) => e.url)).not.toContain('https://internal.example.com/mcp');
  });

  it('returns nothing for an unknown end user', async () => {
    const endpoints = await listExternalMcpEndpoints(appDb, {
      orgId,
      endUserId: 'eu_does_not_exist',
      conversationId: null,
    });
    expect(endpoints).toEqual([]);
  });
});

(skipReason ? describe.skip : describe)('external MCP identity assertions on an email conversation', () => {
  const SERVER_URL = 'https://crm.example.com/mcp';
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let endUserId: string;
  let emailChannelId: string;
  let chatChannelId: string;
  let contactId: string;
  let displayId = 0;

  async function conversationWithLatestTurn(
    channelId: string,
    metadata: Record<string, unknown>,
  ): Promise<string> {
    displayId += 1;
    const [conv] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId, channelId, contactId, endUserId })
      .returning();
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId: conv!.id,
      authorType: 'end_user',
      authorId: contactId,
      body: 'please cancel my subscription',
      metadata,
    });
    return conv!.id;
  }

  async function assertionPayload(conversationId: string, channelType: string) {
    const endpoints = await listExternalMcpEndpoints(appDb, {
      orgId,
      endUserId,
      conversationId,
      channelType,
    });
    expect(endpoints).toHaveLength(1);
    const jwks = createLocalJWKSet(await readOrgConnectorJwks(appDb, orgId));
    const { payload } = await jwtVerify(endpoints[0]!.identityAssertion, jwks, {
      audience: SERVER_URL,
    });
    return payload;
  }

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    appDb = createDb(
      TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@'),
    );

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'External MCP Sender Auth Test Org' })
      .returning();
    orgId = org!.id;
    const [eu] = await db
      .insert(schema.endUsers)
      .values({
        orgId,
        externalId: 'email:kari@example.com',
        email: 'kari@example.com',
        phone: '+4712345678',
        name: 'Kari Nordmann',
        metadata: { source: 'email-inbound', emailSource: 'channel' },
      })
      .returning();
    endUserId = eu!.id;
    const [emailChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'imap', name: 'support-email', config: {} })
      .returning();
    emailChannelId = emailChannel!.id;
    const [chatChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'widget', name: 'support-chat', config: {} })
      .returning();
    chatChannelId = chatChannel!.id;
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: 'kari@example.com', endUserId })
      .returning();
    contactId = contact!.id;

    const encrypted = await appDb.transaction(async (tx) => {
      const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
        sql`SELECT ${encryptSecretSql('secret_token_789')} AS ct`,
      );
      return rows[0]!.ct;
    });
    await db.insert(schema.connectorConnections).values({
      orgId,
      vendor: CUSTOM_MCP_VENDOR,
      domain: 'mcp',
      name: 'Billing',
      config: {
        url: SERVER_URL,
        encryptedBearerToken: encrypted,
        allowedTools: ['cancel_subscription'],
      },
      active: true,
      credentialState: 'active',
    });
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  it('asserts the From address as channel_asserted when the latest message passed DMARC', async () => {
    const conversationId = await conversationWithLatestTurn(emailChannelId, {
      senderAuth: 'pass',
      provenEmail: 'kari@example.com',
    });
    const payload = await assertionPayload(conversationId, 'email');
    expect(payload.sub).toBe(endUserId);
    expect(payload.email).toBe('kari@example.com');
    expect(payload.email_provenance).toBe('channel_asserted');
    expect(payload.phone).toBe('+4712345678');
    expect(payload.name).toBe('Kari Nordmann');
    expect(payload).not.toHaveProperty('identity_withheld');
  });

  it.each([
    ['failed DMARC', 'fail', 'sender_auth_failed'],
    ['was forwarded', 'forwarded', 'sender_forwarded'],
  ])(
    'withholds every identifier when the latest message %s, so a forged From cannot act as that customer',
    async (_label, senderAuth, reason) => {
      const conversationId = await conversationWithLatestTurn(emailChannelId, { senderAuth });
      const payload = await assertionPayload(conversationId, 'email');
      expect(payload.org_id).toBe(orgId);
      expect(payload.identity_withheld).toBe(reason);
      expect(payload).not.toHaveProperty('sub');
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('email_provenance');
      expect(payload).not.toHaveProperty('phone');
      expect(payload).not.toHaveProperty('phone_provenance');
      expect(payload).not.toHaveProperty('name');
    },
  );

  it('withholds identity for a mixed turn where any message failed DMARC', async () => {
    const conversationId = await conversationWithLatestTurn(emailChannelId, {
      senderAuth: 'pass',
      provenEmail: 'kari@example.com',
    });
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId,
      authorType: 'end_user',
      authorId: contactId,
      body: 'and refund it to this new card',
      metadata: { senderAuth: 'fail' },
    });
    const claims = await readIdentityClaims(appDb, {
      orgId,
      endUserId,
      conversationId,
      channelType: 'email',
    });
    expect(claims?.withheld).toBe('sender_auth_failed');
    expect(claims?.email).toBeNull();
  });

  it('leaves a chat conversation without sender-auth verdicts unchanged', async () => {
    const conversationId = await conversationWithLatestTurn(chatChannelId, {});
    const payload = await assertionPayload(conversationId, 'chat');
    expect(payload.sub).toBe(endUserId);
    expect(payload.email).toBe('kari@example.com');
    expect(payload.email_provenance).toBe('authenticated');
    expect(payload).not.toHaveProperty('identity_withheld');
  });

  it('does not read a verdict from a conversation that belongs to another end user', async () => {
    const [other] = await db
      .insert(schema.endUsers)
      .values({ orgId, email: 'ola@example.com', metadata: { emailSource: 'channel' } })
      .returning();
    const conversationId = await conversationWithLatestTurn(emailChannelId, { senderAuth: 'fail' });
    const claims = await readIdentityClaims(appDb, {
      orgId,
      endUserId: other!.id,
      conversationId,
      channelType: 'email',
    });
    expect(claims?.email).toBe('ola@example.com');
    expect(claims?.withheld).toBeNull();
  });
});
