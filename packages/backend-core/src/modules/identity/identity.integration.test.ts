import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';
import { findOrCreateEndUserByEmail } from '../conv/end-user-by-email.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run identity integration tests.';

const INBOUND_EMAIL = 'jane@acme.com';

(skipReason ? describe.skip : describe)('Identity integration: resolve + get over /mcp', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let otherOrgId: string;
  let adminKey: string;
  let otherAdminKey: string;
  let endUserToken: string;
  let endUserId: string;
  let conversationId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_INBOUND_POLL_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Identity IT Org' }).returning();
    orgId = org!.id;
    const [other] = await db.insert(schema.orgs).values({ name: 'Identity IT Other Org' }).returning();
    otherOrgId = other!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'identity-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    otherAdminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: otherOrgId,
      type: 'admin',
      name: 'identity-it-other-admin',
      keyHash: hashSecret(otherAdminKey),
      keyPrefix: keyPrefix(otherAdminKey),
      scopes: ['*'],
    });

    endUserId = await findOrCreateEndUserByEmail(db, orgId, INBOUND_EMAIL, 'Jane', 'email-inbound');

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', name: 'Inbox', vendor: 'imap' })
      .returning();
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: INBOUND_EMAIL, name: 'Jane', endUserId })
      .returning();
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: 1,
        channelId: channel!.id,
        endUserId,
        contactId: contact!.id,
        subject: 'Where is my order?',
        lastMessageAt: new Date('2026-03-01'),
      })
      .returning();
    conversationId = conv!.id;

    const [otherChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', name: 'Inbox', vendor: 'imap' })
      .returning();
    const strangerId = await findOrCreateEndUserByEmail(db, orgId, 'bob@acme.com', 'Bob', 'email-inbound');
    await db.insert(schema.convConversations).values({
      orgId,
      displayId: 2,
      channelId: otherChannel!.id,
      endUserId: strangerId,
      subject: 'Unrelated',
      lastMessageAt: new Date('2026-03-02'),
    });

    endUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['identity:read', 'conv:read'],
      audiences: ['self_service'],
      endUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.orgs).where(sql`id = ${otherOrgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  it('an inbound email leaves an end user with no CRM contact, and identity_resolve says so', async () => {
    const crmRows = await db
      .select({ id: schema.crmContacts.id })
      .from(schema.crmContacts)
      .where(sql`org_id = ${orgId}`);
    expect(crmRows).toHaveLength(0);

    await withClient(adminKey, async (c) => {
      const res = parseToolResult<{
        endUserId: string | null;
        matchedOn: string | null;
        crmContactId: string | null;
        name: string | null;
      }>(await c.callTool({ name: 'identity_resolve', arguments: { email: INBOUND_EMAIL } }));
      expect(res.endUserId).toBe(endUserId);
      expect(res.matchedOn).toBe('email');
      expect(res.crmContactId).toBeNull();
      expect(res.name).toBe('Jane');
    });
  });

  it('identity_get reports the channels and conversation count for that person', async () => {
    await withClient(adminKey, async (c) => {
      const profile = parseToolResult<{
        id: string;
        channels: string[];
        conversationCount: number;
        crmContactId: string | null;
        convContactId: string | null;
      }>(await c.callTool({ name: 'identity_get', arguments: { endUserId } }));
      expect(profile.id).toBe(endUserId);
      expect(profile.channels).toEqual(['email']);
      expect(profile.conversationCount).toBe(1);
      expect(profile.convContactId).not.toBeNull();
      expect(profile.crmContactId).toBeNull();
    });
  });

  it('conv_list_conversations filtered by endUserId returns only that person', async () => {
    await withClient(adminKey, async (c) => {
      const all = parseToolResult<Array<{ id: string }>>(
        await c.callTool({ name: 'conv_list_conversations', arguments: {} }),
      );
      expect(all.length).toBe(2);

      const mine = parseToolResult<Array<{ id: string }>>(
        await c.callTool({ name: 'conv_list_conversations', arguments: { endUserId } }),
      );
      expect(mine.map((r) => r.id)).toEqual([conversationId]);
    });
  });

  it('a miss returns a null endUserId rather than an error', async () => {
    await withClient(adminKey, async (c) => {
      const res = parseToolResult<{ endUserId: string | null; matchedOn: string | null }>(
        await c.callTool({ name: 'identity_resolve', arguments: { email: 'nobody@nowhere.test' } }),
      );
      expect(res.endUserId).toBeNull();
      expect(res.matchedOn).toBeNull();
    });
  });

  it('an admin in another org cannot resolve this org’s address', async () => {
    await withClient(otherAdminKey, async (c) => {
      const res = parseToolResult<{ endUserId: string | null }>(
        await c.callTool({ name: 'identity_resolve', arguments: { email: INBOUND_EMAIL } }),
      );
      expect(res.endUserId).toBeNull();
    });
  });

  it('the identity tools are not exposed to an end-user audience token', async () => {
    await withClient(endUserToken, async (c) => {
      const listed = await c.listTools();
      expect(listed.tools.map((t) => t.name)).not.toContain('identity_resolve');
      expect(listed.tools.map((t) => t.name)).not.toContain('identity_get');

      const result = await c.callTool({
        name: 'identity_resolve',
        arguments: { email: INBOUND_EMAIL },
      });
      expect(result.isError).toBe(true);
    });
  });

  it('both identity tools are listed with a title and a read-only hint', async () => {
    await withClient(adminKey, async (c) => {
      const listed = await c.listTools();
      for (const name of ['identity_resolve', 'identity_get']) {
        const tool = listed.tools.find((t) => t.name === name);
        expect(tool, name).toBeDefined();
        expect(tool!.annotations?.title, name).toBeTruthy();
        expect(tool!.annotations?.readOnlyHint, name).toBe(true);
        expect(tool!.annotations?.destructiveHint, name).toBe(false);
      }
    });
  });

  it('exposes the look-up-a-person skill as a resource', async () => {
    await withClient(adminKey, async (c) => {
      const resources = await c.listResources();
      expect(resources.resources.map((r) => r.uri)).toContain('skill://identity/look-up-a-person');
    });
  });
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
