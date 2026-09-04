import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix, signHmac } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, and, eq } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run email relay integration tests.';

const RELAY_SECRET = 'relay-integration-secret';
const RELAY_DOMAIN = 'in.getmunin.test';

(skipReason ? describe.skip : describe)(
  'Email relay inbound: forwarded mail becomes a conversation',
  () => {
    let app: INestApplication;
    let baseUrl: string;
    let db: ReturnType<typeof createDb>;
    let orgId: string;
    let adminKey: string;
    let relayAddress: string;
    let channelId: string;

    beforeAll(async () => {
      process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
      process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
      process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
      process.env.MUNIN_MAIL_PROVIDER = 'stub';
      process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
      process.env.MUNIN_EMAIL_RELAY_SECRET = RELAY_SECRET;
      process.env.MUNIN_EMAIL_RELAY_DOMAIN = RELAY_DOMAIN;
      process.env.MUNIN_SSRF_ALLOW_PRIVATE = '1';

      await runMigrations(TEST_URL!);

      const appUrl = TEST_URL!.replace(
        /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
        '$1munin_app:munin_app@',
      );
      process.env.DATABASE_URL = appUrl;

      db = createDb(TEST_URL!, { serviceRole: true });
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

      const [org] = await db.insert(schema.orgs).values({ name: 'Relay IT Org' }).returning();
      orgId = org!.id;

      adminKey = buildApiKey('admin');
      await db.insert(schema.apiKeys).values({
        orgId,
        type: 'admin',
        name: 'relay-it-admin',
        keyHash: hashSecret(adminKey),
        keyPrefix: keyPrefix(adminKey),
        scopes: ['*'],
      });

      app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
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
      }
    });

    async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const c = new Client({ name: 'munin-relay-it', version: '0.0.0' });
      await c.connect(transport);
      try {
        return await fn(c);
      } finally {
        await transport.close();
        await c.close();
      }
    }

    async function postRelay(
      payload: Record<string, unknown>,
      opts?: { signature?: string },
    ): Promise<{ status: number; body: string }> {
      const body = JSON.stringify(payload);
      const signature = opts?.signature ?? signHmac(Buffer.from(body, 'utf8'), RELAY_SECRET);
      const res = await fetch(`${baseUrl}/v1/conversations/email/relay`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-munin-relay-signature': signature,
        },
        body,
      });
      return { status: res.status, body: await res.text() };
    }

    function rawForwarded(): string {
      return [
        'From: Acme Ops <ops@acme.test>',
        `To: <${relayAddress}>`,
        'Subject: Fwd: Order never arrived',
        'Message-ID: <fwd-1@acme.test>',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Please handle this one.',
        '',
        '---------- Forwarded message ---------',
        'From: Kari Nordmann <kari@example.test>',
        'Date: Mon, 1 Sep 2025 at 10:00',
        'Subject: Order never arrived',
        'To: <support@acme.test>',
        '',
        'My order never arrived, can you help?',
        '',
      ].join('\r\n');
    }

    it('mints an address under the configured domain, needs no credential link, and activates immediately', async () => {
      const result = await withClient(adminKey, async (c) =>
        c.callTool({
          name: 'conv_configure_email_channel',
          arguments: {
            name: 'Acme Support (forwarding)',
            config: {
              addressing: { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
              outbound: { provider: 'mailer' },
              inbound: { provider: 'relay' },
            },
          },
        }),
      );
      if ((result as { isError?: boolean }).isError) {
        throw new Error(`conv_configure_email_channel failed: ${JSON.stringify(result)}`);
      }

      const rows = await db
        .select()
        .from(schema.convChannels)
        .where(and(eq(schema.convChannels.orgId, orgId), eq(schema.convChannels.type, 'email')));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.active).toBe(true);

      const inbound = (rows[0]!.config as { inbound?: { provider?: string; address?: string } })
        .inbound;
      expect(inbound?.provider).toBe('relay');
      expect(inbound?.address).toMatch(
        new RegExp(`^[0-9a-f]{16}@${RELAY_DOMAIN.replace(/\./g, '\\.')}$`),
      );

      relayAddress = inbound!.address!;
      channelId = rows[0]!.id;
    });

    it('keeps the minted address across an unrelated edit', async () => {
      const result = await withClient(adminKey, async (c) =>
        c.callTool({
          name: 'conv_configure_email_channel',
          arguments: {
            channelId,
            name: 'Acme Support (renamed)',
            config: {
              addressing: { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
              outbound: { provider: 'mailer' },
              inbound: { provider: 'relay' },
            },
          },
        }),
      );
      if ((result as { isError?: boolean }).isError) {
        throw new Error(`conv_configure_email_channel failed: ${JSON.stringify(result)}`);
      }

      const rows = await db
        .select()
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, channelId));
      const inbound = (rows[0]!.config as { inbound?: { address?: string } }).inbound;
      expect(inbound?.address).toBe(relayAddress);
      expect(rows[0]!.name).toBe('Acme Support (renamed)');
    });

    it('rejects an unsigned relay post', async () => {
      const res = await postRelay(
        { recipient: relayAddress, raw: Buffer.from(rawForwarded()).toString('base64') },
        { signature: 'deadbeef' },
      );
      expect(res.status).toBe(401);
    });

    it('reports an unknown recipient without creating anything', async () => {
      const res = await postRelay({
        recipient: 'nobody@in.getmunin.test',
        raw: Buffer.from(rawForwarded()).toString('base64'),
      });
      expect(res.status).toBe(201);
      expect(res.body).toContain('unknown_recipient');
    });

    it('attributes a manually forwarded message to the original sender, not the forwarder', async () => {
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(rawForwarded()).toString('base64'),
      });
      expect(res.status).toBe(201);
      expect(res.body).toContain('ingested');

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

      const contacts = await db
        .select()
        .from(schema.convContacts)
        .where(eq(schema.convContacts.orgId, orgId));
      const emails = contacts.map((c) => c.email);
      expect(emails).toContain('kari@example.test');
      expect(emails).not.toContain('ops@acme.test');

      const conversations = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.orgId, orgId));
      expect(conversations).toHaveLength(1);

      const messages = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.orgId, orgId));
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toContain('My order never arrived');
      expect(messages[0]!.metadata).toMatchObject({
        forwarding: { kind: 'manual-forward', forwardedBy: 'ops@acme.test' },
      });
    });

    it('does not ingest the same forwarded message twice', async () => {
      await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(rawForwarded()).toString('base64'),
      });

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const messages = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.orgId, orgId));
      expect(messages).toHaveLength(1);
    });
  },
);
