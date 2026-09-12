import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix, signHmac } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, and, eq } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { EMAIL_RELAY_MAX_RAW_BYTES } from './email-relay.constants.ts';

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

      app = await createApp(AppModule, { logger: false });
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
      opts?: { signature?: string | null },
    ): Promise<{ status: number; body: string }> {
      const body = JSON.stringify(payload);
      const signature =
        opts?.signature === undefined
          ? signHmac(Buffer.from(body, 'utf8'), RELAY_SECRET)
          : opts.signature;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (signature !== null) headers['x-munin-relay-signature'] = signature;
      const res = await fetch(`${baseUrl}/v1/conversations/email/relay`, {
        method: 'POST',
        headers,
        body,
      });
      return { status: res.status, body: await res.text() };
    }

    function rawWithAttachment(messageId: string, attachmentBytes: number): string {
      const boundary = 'relay-it-boundary';
      const attachment = Buffer.alloc(attachmentBytes, 0x41)
        .toString('base64')
        .replace(/(.{76})/g, '$1\r\n');
      return [
        'From: Kari Nordmann <kari@example.test>',
        `To: <${relayAddress}>`,
        'Subject: Quarterly report attached',
        `Message-ID: <${messageId}>`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Please find the quarterly report attached.',
        '',
        `--${boundary}`,
        'Content-Type: application/octet-stream; name="report.bin"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="report.bin"',
        '',
        attachment,
        `--${boundary}--`,
        '',
      ].join('\r\n');
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
      expect(inbound?.address).toMatch(/^[0-9a-f]{16}@/);
      expect(inbound?.address?.endsWith(`@${RELAY_DOMAIN}`)).toBe(true);

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

    function rawEspBounce(): string {
      const blob = 'U2FsdGVkX1+vR016HqB5QcbgGd5+4Eex4u6/2A6RhuuR0TsOhj9aUu1DZ5vUzKqAKhK7CEw';
      return [
        'From: Mail Delivery Subsystem <bounces@amazonses.com>',
        `To: <${relayAddress}>`,
        'Subject: 4.2.2 Automatically rejected mail',
        'Message-ID: <bounce-1@amazonses.com>',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        "Your message to edma@rosenberg.as was rejected: the recipient's mailbox is full.",
        '',
        `X-HE-Meta: ${blob}`,
        ...Array.from({ length: 40 }, () => blob),
        '',
      ].join('\r\n');
    }

    it('stamps an ESP bounce as suppressed and strips the encoded blob it echoes back', async () => {
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(rawEspBounce()).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const messages = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.orgId, orgId));
      const bounce = messages.find((m) => m.body.includes('rejected'));
      expect(bounce).toBeDefined();
      expect(bounce!.metadata).toMatchObject({ suppressed: 'bounce' });
      expect(bounce!.body).not.toContain('U2FsdGVkX1');
      expect(bounce!.body).toContain('lines of encoded data removed');
      expect(JSON.stringify(bounce!.metadata)).not.toContain('U2FsdGVkX1');
    });

    function rawOutOfOffice(messageId: string, from: string): string {
      return [
        `From: Kari Nordmann <${from}>`,
        `To: <${relayAddress}>`,
        'Subject: Automatisk svar: Nyhetsbrev februar',
        `Message-ID: <${messageId}>`,
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Jeg er ute av kontoret til 3. mars.',
        '',
      ].join('\r\n');
    }

    it('files a newsletter out-of-office away closed, so it never reaches the inbox queue', async () => {
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(rawOutOfOffice('ooo-1@kunde.no', 'kari@kunde.no')).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const msg = (
        await db.select().from(schema.convMessages).where(eq(schema.convMessages.orgId, orgId))
      ).find((m) => m.body.includes('ute av kontoret'));
      expect(msg).toBeDefined();
      expect(msg!.metadata).toMatchObject({ suppressed: 'auto_reply' });

      const conv = (
        await db
          .select()
          .from(schema.convConversations)
          .where(eq(schema.convConversations.id, msg!.conversationId))
      )[0];
      expect(conv!.status).toBe('closed');
      expect(conv!.needsHumanAttention).toBe(false);
    });

    it('files a Microsoft 365 out-of-office away closed, though its envelope sender is postmaster@', async () => {
      const raw = [
        'From: Ole-Martin <ole-martin@nortekstil.no>',
        `To: <${relayAddress}>`,
        'Return-Path: <postmaster@osppr02cu001.outbound.protection.outlook.com>',
        'Subject: Automatic reply: Nyhetsbrev februar',
        'Message-ID: <ooo-m365@nortekstil.no>',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Jeg er paa reise, men leser og svarer epost naar jeg har mulighet.',
        '',
      ].join('\r\n');
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(raw).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const msg = (
        await db.select().from(schema.convMessages).where(eq(schema.convMessages.orgId, orgId))
      ).find((m) => m.body.includes('paa reise'));
      expect(msg).toBeDefined();
      expect(msg!.metadata).toMatchObject({ suppressed: 'auto_reply' });

      const conv = (
        await db
          .select()
          .from(schema.convConversations)
          .where(eq(schema.convConversations.id, msg!.conversationId))
      )[0];
      expect(conv!.status).toBe('closed');
    });

    it('files a bounce that opens a conversation of its own away closed too', async () => {
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(rawEspBounce()).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const msg = (
        await db.select().from(schema.convMessages).where(eq(schema.convMessages.orgId, orgId))
      ).find((m) => m.body.includes('rejected'));
      expect(msg).toBeDefined();

      const conv = (
        await db
          .select()
          .from(schema.convConversations)
          .where(eq(schema.convConversations.id, msg!.conversationId))
      )[0];
      expect(conv!.status).toBe('closed');
      expect(conv!.needsHumanAttention).toBe(false);
    });

    it('files away closed a deleted-mailbox notice from an address that takes no replies', async () => {
      const raw = [
        'From: noreply.autoresponder_NO_01 <noreply.autoresponder.no@kaefer.no>',
        `To: <${relayAddress}>`,
        'Subject: This mailbox is no longer available',
        'Message-ID: <deleted-mailbox@kaefer.no>',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'We are sorry, but the email address you have tried to reach does not exist',
        'within our company anymore.',
        '',
      ].join('\r\n');
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(raw).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const msg = (
        await db.select().from(schema.convMessages).where(eq(schema.convMessages.orgId, orgId))
      ).find((m) => m.body.includes('does not exist'));
      expect(msg).toBeDefined();
      expect(msg!.metadata).toMatchObject({ suppressed: 'no_reply_address' });

      const conv = (
        await db
          .select()
          .from(schema.convConversations)
          .where(eq(schema.convConversations.id, msg!.conversationId))
      )[0];
      expect(conv!.status).toBe('closed');
      expect(conv!.needsHumanAttention).toBe(false);
    });

    it('leaves a live customer thread open when a later auto-reply lands on it', async () => {
      await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(
          [
            'From: Ola Nordmann <ola@kunde.no>',
            `To: <${relayAddress}>`,
            'Subject: Faktura mangler',
            'Message-ID: <real-1@kunde.no>',
            'Content-Type: text/plain; charset="utf-8"',
            '',
            'Jeg har ikke fått fakturaen.',
            '',
          ].join('\r\n'),
        ).toString('base64'),
      });

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const real = (
        await db.select().from(schema.convMessages).where(eq(schema.convMessages.orgId, orgId))
      ).find((m) => m.body.includes('ikke fått fakturaen'));
      const convId = real!.conversationId;

      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: convId,
        authorType: 'end_user',
        authorId: real!.authorId,
        body: 'Automatisk svar',
        metadata: { suppressed: 'auto_reply' },
      });

      const conv = (
        await db
          .select()
          .from(schema.convConversations)
          .where(eq(schema.convConversations.id, convId))
      )[0];
      expect(conv!.status).toBe('open');
    });

    it('still answers a real question sent as a reply to the same newsletter', async () => {
      await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(rawOutOfOffice('ooo-2@kunde.no', 'siri@kunde.no')).toString('base64'),
      });

      const real = [
        'From: Siri Hansen <siri@kunde.no>',
        `To: <${relayAddress}>`,
        'Subject: Re: Nyhetsbrev februar',
        'Message-ID: <real-2@kunde.no>',
        'In-Reply-To: <newsletter-feb@marketing.uscore.no>',
        'References: <newsletter-feb@marketing.uscore.no>',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Hei! Tilbudet i nyhetsbrevet, gjelder det ogsa for eksisterende kunder?',
        '',
      ].join('\r\n');
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(real).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.orgId, orgId));
      const question = rows.find((m) => m.body.includes('gjelder det ogsa'));
      const ooo = rows.find(
        (m) => m.body.includes('ute av kontoret') && m.conversationId !== question?.conversationId,
      );

      expect(question).toBeDefined();
      expect(question!.metadata).not.toHaveProperty('suppressed');
      expect(question!.conversationId).not.toBe(ooo?.conversationId);

      const conv = (
        await db
          .select()
          .from(schema.convConversations)
          .where(eq(schema.convConversations.id, question!.conversationId))
      )[0];
      expect(conv!.status).toBe('open');
      expect(conv!.endUserId).not.toBeNull();

      const awaiting = await fetch(`${baseUrl}/v1/conversations/awaiting-reply`, {
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      const body = (await awaiting.json()) as { items: Array<{ id: string }> };
      expect(body.items.map((i) => i.id)).toContain(question!.conversationId);
    });

    it('ingests a message far above the 4mb global JSON body limit', async () => {
      const raw = Buffer.from(rawWithAttachment('big-1@example.test', 4_800_000));
      expect(raw.byteLength).toBeGreaterThan(6 * 1024 * 1024);

      const res = await postRelay({ recipient: relayAddress, raw: raw.toString('base64') });
      expect(res.status).toBe(201);
      expect(res.body).toContain('ingested');

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const messages = await db
        .select()
        .from(schema.convMessages)
        .where(
          and(
            eq(schema.convMessages.orgId, orgId),
            sql`${schema.convMessages.metadata}->>'inboundMessageId' = 'big-1@example.test'`,
          ),
        );
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toContain('quarterly report attached');
    });

    it('rejects an unsigned oversized post before the controller runs', async () => {
      const raw = Buffer.from(rawWithAttachment('big-2@example.test', 4_800_000));
      const res = await postRelay(
        { recipient: relayAddress, raw: raw.toString('base64') },
        { signature: null },
      );
      expect(res.status).toBe(401);
      expect(res.body).toContain('relay signature missing');

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const messages = await db
        .select()
        .from(schema.convMessages)
        .where(
          and(
            eq(schema.convMessages.orgId, orgId),
            sql`${schema.convMessages.metadata}->>'inboundMessageId' = 'big-2@example.test'`,
          ),
        );
      expect(messages).toHaveLength(0);
    });

    it('still refuses a message over the relay maximum with the controller 413', async () => {
      const raw = Buffer.alloc(EMAIL_RELAY_MAX_RAW_BYTES + 1, 0x41);
      const res = await postRelay({ recipient: relayAddress, raw: raw.toString('base64') });
      expect(res.status).toBe(413);
      expect(res.body).toContain('message too large');
    });

    it('records the recipient a delivery-status report names as undeliverable', async () => {
      const raw = [
        'From: Mail Delivery System <MAILER-DAEMON@mx.kaefer.no>',
        `To: <${relayAddress}>`,
        'Subject: Undelivered Mail Returned to Sender',
        'Message-ID: <dsn-945@mx.kaefer.no>',
        'Content-Type: multipart/report; report-type=delivery-status; boundary="dsnsep"',
        '',
        '--dsnsep',
        'Content-Type: text/plain; charset="us-ascii"',
        '',
        'This is the mail system at host mx.kaefer.no.',
        '',
        '--dsnsep',
        'Content-Type: message/delivery-status',
        '',
        'Reporting-MTA: dns; mx.kaefer.no',
        '',
        'Final-Recipient: rfc822; Gone.Person@Kaefer.no',
        'Action: failed',
        'Status: 5.1.1',
        'Diagnostic-Code: smtp; 550 5.1.1 User unknown',
        '',
        '--dsnsep--',
        '',
      ].join('\r\n');

      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(raw).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select()
        .from(schema.crmAddressDeliverability)
        .where(
          and(
            eq(schema.crmAddressDeliverability.orgId, orgId),
            eq(schema.crmAddressDeliverability.address, 'gone.person@kaefer.no'),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.state).toBe('undeliverable');
      expect(rows[0]!.reason).toBe('hard_bounce');
      expect(rows[0]!.failureCount).toBe(1);
    });

    it('soft-marks the address a no-reply mailbox notice answers on an existing thread', async () => {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const [contact] = await db
        .insert(schema.convContacts)
        .values({ orgId, name: 'Gone Colleague', email: 'Gone.Colleague@Kaefer.no' })
        .returning();
      const [conv] = await db
        .insert(schema.convConversations)
        .values({
          orgId,
          displayId: 9945,
          channelId,
          contactId: contact!.id,
          status: 'open',
          subject: 'Introduksjon',
        })
        .returning();
      const [outbound] = await db
        .insert(schema.convMessages)
        .values({
          orgId,
          conversationId: conv!.id,
          authorType: 'agent',
          authorId: 'agt_test',
          body: 'Hei!',
        })
        .returning();
      await db.insert(schema.convMessageDeliveries).values({
        orgId,
        messageId: outbound!.id,
        channelId,
        status: 'sent',
        messageIdHeader: 'outbound-945@getmunin.test',
      });

      const raw = [
        'From: noreply.autoresponder_NO_01 <noreply.autoresponder.no@kaefer.no>',
        `To: <${relayAddress}>`,
        'Subject: This mailbox is no longer available',
        'Message-ID: <no-reply-945@kaefer.no>',
        'In-Reply-To: <outbound-945@getmunin.test>',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'We are sorry, but the email address you have tried to reach does not exist',
        'within our company anymore.',
        '',
      ].join('\r\n');
      const res = await postRelay({
        recipient: relayAddress,
        raw: Buffer.from(raw).toString('base64'),
      });
      expect(res.status).toBe(201);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db
        .select()
        .from(schema.crmAddressDeliverability)
        .where(
          and(
            eq(schema.crmAddressDeliverability.orgId, orgId),
            eq(schema.crmAddressDeliverability.address, 'gone.colleague@kaefer.no'),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.state).toBe('soft_failing');
      expect(rows[0]!.reason).toBe('no_reply_notice');
    });

    it('is not throttled per client IP: 65 signed posts in a minute all get through', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 65; i++) {
        const res = await postRelay({
          recipient: `nobody-${i}@in.getmunin.test`,
          raw: Buffer.from(rawForwarded()).toString('base64'),
        });
        statuses.push(res.status);
      }
      expect(statuses).not.toContain(429);
      expect(new Set(statuses)).toEqual(new Set([201]));
    });
  },
);
