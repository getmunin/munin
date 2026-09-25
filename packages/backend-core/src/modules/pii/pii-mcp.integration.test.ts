import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { PII_RAW_SCOPE } from '@getmunin/types';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../bootstrap-app.ts';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run MCP pseudonymization integration tests.';

const FNR = '01819012365';

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

(skipReason ? describe.skip : describe)('MCP result pseudonymization', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let conversationId: string;
  let messageId: string;
  let contactId: string;
  const rawKey = buildApiKey('admin');
  const pseudonymizedKey = buildApiKey('admin');
  const connectorToken = randomBytes(24).toString('base64url');
  const rawConnectorToken = randomBytes(24).toString('base64url');

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'PII MCP Org' }).returning();
    orgId = org!.id;
    await db.insert(schema.apiKeys).values([
      {
        orgId,
        type: 'admin',
        name: 'raw',
        keyHash: hashSecret(rawKey),
        keyPrefix: keyPrefix(rawKey),
        scopes: ['*'],
      },
      {
        orgId,
        type: 'admin',
        name: 'pseudonymized',
        keyHash: hashSecret(pseudonymizedKey),
        keyPrefix: keyPrefix(pseudonymizedKey),
        scopes: ['conv:read', 'crm:read'],
      },
    ]);
    const [user] = await db
      .insert(schema.users)
      .values({ email: `owner-${orgId}@example.com`, name: 'Org Owner' })
      .returning();
    await db.insert(schema.orgMembers).values({ orgId, userId: user!.id, role: 'owner', isDefault: true });
    const clientId = `client_${orgId}`;
    await db.insert(schema.oauthClient).values({
      clientId,
      name: 'Claude',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    });
    const expiresAt = new Date(Date.now() + 3_600_000);
    const hashed = (token: string) => createHash('sha256').update(token).digest('base64url');
    await db.insert(schema.oauthAccessToken).values([
      {
        token: hashed(connectorToken),
        clientId,
        userId: user!.id,
        referenceId: orgId,
        expiresAt,
        scopes: ['mcp:admin', 'conv:read', 'crm:read'],
      },
      {
        token: hashed(rawConnectorToken),
        clientId,
        userId: user!.id,
        referenceId: orgId,
        expiresAt,
        scopes: ['mcp:admin', 'conv:read', 'crm:read', PII_RAW_SCOPE],
      },
    ]);

    const [contact] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Kari Nordmann', email: 'kari@example.no', phone: '+4712345678' })
      .returning();
    contactId = contact!.id;
    const [convContact] = await db
      .insert(schema.convContacts)
      .values({ orgId, name: 'Kari Nordmann', email: 'kari@example.no' })
      .returning();
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'mailer', name: 'Support' })
      .returning();
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId: 1, channelId: channel!.id, contactId: convContact!.id, subject: 'Faktura til Kari' })
      .returning();
    conversationId = conversation!.id;
    const [message] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'end_user',
        authorId: convContact!.id,
        body: `Hei, jeg er Kari Nordmann (kari@example.no). Kollegaen min Per Olsen ringer fra +47 12 34 56 78. Fnr ${FNR}. Mvh Kari`,
      })
      .returning();
    messageId = message!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as { address(): AddressInfo | string | null }).address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    delete process.env.MUNIN_PII_NER_ENABLED;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db && orgId) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      await db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, `client_${orgId}`));
      await db.delete(schema.users).where(eq(schema.users.email, `owner-${orgId}@example.com`));
    }
  });

  async function call(token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'pii-it', version: '0.0.0' });
    await client.connect(transport);
    try {
      return (await client.callTool({ name, arguments: args }));
    } finally {
      await transport.close();
      await client.close();
    }
  }

  function body(result: ToolResult): string {
    return result.content[0]?.text ?? '';
  }

  function piiMeta(result: ToolResult): { coverage: string; layers: string[] } | undefined {
    return result._meta?.['munin/pii'] as { coverage: string; layers: string[] } | undefined;
  }

  it('returns raw data to a credential holding the raw scope', async () => {
    const result = await call(rawKey, 'conv_get_conversation', { id: conversationId });
    expect(body(result)).toContain('Kari Nordmann');
    expect(body(result)).toContain(FNR);
    expect(piiMeta(result)).toBeUndefined();
    expect(result.content).toHaveLength(1);
  });

  it('pseudonymizes every carrier for a credential without it', async () => {
    const result = await call(pseudonymizedKey, 'conv_get_conversation', { id: conversationId });
    const text = body(result);
    expect(text).not.toContain('Kari');
    expect(text).not.toContain('kari@example.no');
    expect(text).not.toContain('12 34 56 78');
    expect(text).not.toContain(FNR);
    expect(text).toMatch(/\[Contact [a-z2-7]{8}\]/);
    expect(text).toMatch(/contact-[a-z2-7]{8}@pseudonym\.invalid/);
    expect(text).toContain('[NATIONAL_ID]');
    expect(text).toContain(messageId);
    expect(piiMeta(result)).toMatchObject({ coverage: 'complete', layers: ['deterministic', 'directory'] });
    expect(result.content[1]?.text).toMatch(/pseudonymized/);
  });

  it('uses the same token for a person across tools', async () => {
    const conversation = body(await call(pseudonymizedKey, 'conv_get_conversation', { id: conversationId }));
    const contact = body(await call(pseudonymizedKey, 'crm_get_contact', { id: contactId }));
    const token = /\[Contact ([a-z2-7]{8})\]/.exec(conversation)?.[1];
    expect(token).toBeDefined();
    expect(contact).toContain(`[Contact ${token}]`);
    expect(contact).toContain(`contact-${token}@pseudonym.invalid`);
    expect(contact).not.toContain('Kari');
  });

  it('masks a third party once the NER worker has found them', async () => {
    const before = body(await call(pseudonymizedKey, 'conv_get_conversation', { id: conversationId }));
    expect(before).toContain('Per Olsen');
    await db.insert(schema.piiMessageAnnotations).values({ messageId, orgId, nerVersion: 100 });
    await db.insert(schema.piiSpans).values({
      orgId,
      messageId,
      startOffset: 0,
      endOffset: 9,
      kind: 'person',
      surface: 'Per Olsen',
      source: 'spacy',
      detectorVersion: 100,
    });
    const after = body(await call(pseudonymizedKey, 'conv_get_conversation', { id: conversationId }));
    expect(after).not.toContain('Per Olsen');
    expect(after).toContain('[NAME]');
  });

  it('reports pending coverage while NER is enabled and a message has not been annotated', async () => {
    process.env.MUNIN_PII_NER_ENABLED = '1';
    await db.delete(schema.piiMessageAnnotations).where(eq(schema.piiMessageAnnotations.messageId, messageId));
    const pending = await call(pseudonymizedKey, 'conv_get_conversation', { id: conversationId });
    expect(piiMeta(pending)?.coverage).toBe('pending');
    expect(pending.content[1]?.text).toMatch(/not been through name detection/);
    await db.insert(schema.piiMessageAnnotations).values({ messageId, orgId, nerVersion: 100 });
    const complete = await call(pseudonymizedKey, 'conv_get_conversation', { id: conversationId });
    expect(piiMeta(complete)).toMatchObject({ coverage: 'complete', layers: ['deterministic', 'directory', 'ner'] });
  });

  it('accepts a token back as input and resolves it to the real value', async () => {
    const conversation = body(await call(pseudonymizedKey, 'conv_get_conversation', { id: conversationId }));
    const email = /contact-[a-z2-7]{8}@pseudonym\.invalid/.exec(conversation)?.[0];
    expect(email).toBeDefined();
    const found = await call(pseudonymizedKey, 'crm_lookup_contact', { email });
    expect(found.isError).toBeFalsy();
    expect(body(found)).toContain(contactId);
    expect(body(found)).toContain(email);
    expect(body(found)).not.toContain('kari@example.no');
  });

  it('pseudonymizes an OAuth connector unless consent granted raw access', async () => {
    const connector = body(await call(connectorToken, 'conv_get_conversation', { id: conversationId }));
    expect(connector).not.toContain('Kari');
    expect(connector).toMatch(/\[Contact [a-z2-7]{8}\]/);
    const raw = body(await call(rawConnectorToken, 'conv_get_conversation', { id: conversationId }));
    expect(raw).toContain('Kari Nordmann');
  });

  it('refuses a bulk export on a pseudonymized connection and serves it on a raw one', async () => {
    const refused = await call(pseudonymizedKey, 'conv_export', {});
    expect(refused.isError).toBe(true);
    expect(body(refused)).toMatch(/not available on a connection that pseudonymizes/);
    const served = await call(rawKey, 'conv_export', {});
    expect(served.isError).toBeFalsy();
    expect(body(served)).toContain('Kari Nordmann');
  });
});
