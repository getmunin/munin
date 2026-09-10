import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { and, eq, sql } from 'drizzle-orm';
import { ActorIdentity, withContext, type RequestContext, type StubMailer } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { createApp } from '../../../bootstrap-app.ts';
import { AppModule } from '../../../app.module.ts';
import { MAILER } from '../../../common/mail/mail.module.ts';
import { ConvAttachmentsService } from '../attachments/conv-attachments.service.ts';
import { OutboundDeliveryWorker } from '../channels/outbound-delivery.worker.ts';
import type { ChannelRow } from '../channels/adapter.ts';
import { EmailAdapter, parseMessage } from './email-adapter.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run email image integration tests.';

const TRACKING_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

async function noisyImage(
  width: number,
  height: number,
  format: 'png' | 'jpeg',
): Promise<Buffer> {
  const raw = randomBytes(width * height * 3);
  const pipeline = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png' ? pipeline.png().toBuffer() : pipeline.jpeg({ quality: 92 }).toBuffer();
}

interface EmlPart {
  contentType: string;
  disposition: 'inline' | 'attachment';
  filename: string;
  cid?: string;
  content: Buffer;
}

function wrap(b64: string): string {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.join('\r\n');
}

function buildEml(input: {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  text: string;
  html: string;
  parts: EmlPart[];
}): string {
  const related = `rel-${randomUUID()}`;
  const alternative = `alt-${randomUUID()}`;
  const lines: string[] = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: <${input.messageId}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; type="text/html"; boundary="${related}"`,
    '',
    `--${related}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    '',
    `--${alternative}`,
    'Content-Type: text/plain; charset="utf-8"',
    '',
    input.text,
    `--${alternative}`,
    'Content-Type: text/html; charset="utf-8"',
    '',
    input.html,
    `--${alternative}--`,
  ];
  for (const part of input.parts) {
    lines.push(
      `--${related}`,
      `Content-Type: ${part.contentType}; name="${part.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: ${part.disposition}; filename="${part.filename}"`,
      ...(part.cid ? [`Content-ID: <${part.cid}>`] : []),
      '',
      wrap(part.content.toString('base64')),
    );
  }
  lines.push(`--${related}--`, '');
  return lines.join('\r\n');
}

(skipReason ? describe.skip : describe)('email images: inbound MIME parts in, real MIME parts out', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDb>;
  let adapter: EmailAdapter;
  let attachments: ConvAttachmentsService;
  let outboundWorker: OutboundDeliveryWorker;
  let mailer: StubMailer;
  let storageDir: string;
  let orgId: string;
  let channel: ChannelRow;

  let photo: Buffer;
  let inlineShot: Buffer;
  let signatureLogo: Buffer;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    storageDir = await mkdtemp(join(tmpdir(), 'munin-email-img-test-'));
    process.env.MUNIN_STORAGE_LOCAL_PATH = storageDir;
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:1/static/assets';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Email Image Org' }).returning();
    orgId = org!.id;

    const [row] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'mailer',
        name: 'Acme Support',
        config: {
          addressing: { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
          outbound: { provider: 'mailer' },
          inbound: {
            provider: 'imap',
            host: 'imap.acme.test',
            port: 993,
            secure: true,
            username: 'support@acme.test',
            encryptedPassword: 'x',
            mailbox: 'INBOX',
          },
        },
        active: true,
      })
      .returning();
    channel = {
      id: row!.id,
      orgId,
      type: 'email',
      vendor: 'mailer',
      name: row!.name,
      config: row!.config,
      active: true,
      defaultAgentMode: row!.defaultAgentMode,
    };

    photo = await noisyImage(640, 480, 'jpeg');
    inlineShot = await noisyImage(320, 200, 'png');
    signatureLogo = await noisyImage(64, 64, 'png');

    app = await createApp(AppModule, { logger: false });
    await app.init();
    adapter = app.get(EmailAdapter);
    attachments = app.get(ConvAttachmentsService);
    outboundWorker = app.get(OutboundDeliveryWorker);
    mailer = app.get<StubMailer>(MAILER);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      if (orgId) await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it('keeps the photo and the referenced inline shot, drops the signature logo and the tracking pixel, and rewrites cid: to signed urls', async () => {
    const eml = buildEml({
      from: 'Customer One <c1@customer.test>',
      to: 'support@acme.test',
      subject: 'Broken widget — photo attached',
      messageId: 'img-inbound-1@customer.test',
      text: 'The widget arrived cracked. Photo attached, and a screenshot inline.',
      html:
        '<div dir="ltr"><p>The widget arrived cracked.</p>' +
        '<p><img src="cid:shot@customer.test" width="320" height="200"></p>' +
        '<img src="cid:pixel@track.test" width="1" height="1">' +
        '<div class="gmail_signature" data-smartmail="gmail_signature">' +
        '<p>Kind regards,<br>Customer One</p>' +
        '<img src="cid:siglogo@customer.test" width="64" height="64">' +
        '</div></div>',
      parts: [
        {
          contentType: 'image/jpeg',
          disposition: 'attachment',
          filename: 'cracked-widget.jpg',
          content: photo,
        },
        {
          contentType: 'image/png',
          disposition: 'inline',
          filename: 'screenshot.png',
          cid: 'shot@customer.test',
          content: inlineShot,
        },
        {
          contentType: 'image/png',
          disposition: 'inline',
          filename: 'company-logo.png',
          cid: 'siglogo@customer.test',
          content: signatureLogo,
        },
        {
          contentType: 'image/gif',
          disposition: 'inline',
          filename: 'open.gif',
          cid: 'pixel@track.test',
          content: TRACKING_PIXEL_GIF,
        },
      ],
    });

    const parsed = await parseMessage(eml);
    expect(parsed.attachments).toHaveLength(4);
    await adapter.ingest(channel, parsed);

    const messages = await db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.orgId, orgId));
    expect(messages).toHaveLength(1);
    const message = messages[0]!;

    const rows = await db
      .select()
      .from(schema.convAttachments)
      .where(eq(schema.convAttachments.orgId, orgId));
    expect(rows.map((r) => r.name).sort()).toEqual(['cracked-widget.jpg', 'screenshot.png']);
    expect(rows.every((r) => r.messageId === message.id)).toBe(true);
    expect(rows.every((r) => r.uploaded)).toBe(true);
    expect(rows.every((r) => r.storageKey?.startsWith(`conv/${orgId}/`))).toBe(true);

    const shotRow = rows.find((r) => r.name === 'screenshot.png')!;
    expect(shotRow.inline).toBe(true);
    expect(shotRow.contentId).toBe('shot@customer.test');
    expect(shotRow.width).toBe(320);
    expect(shotRow.height).toBe(200);

    const photoRow = rows.find((r) => r.name === 'cracked-widget.jpg')!;
    expect(photoRow.inline).toBe(false);
    expect(photoRow.contentId).toBeNull();
    expect(photoRow.sizeBytes).toBe(photo.length);

    const projection = message.attachments as Array<Record<string, unknown>>;
    expect(projection).toHaveLength(2);
    expect(projection.map((p) => p.id).sort()).toEqual(rows.map((r) => r.id).sort());
    expect(projection.every((p) => p.deleted === false)).toBe(true);

    const html = message.bodyHtml!;
    expect(html).toContain(`cid:${shotRow.contentId}`);
    expect(html).not.toContain('siglogo@customer.test');
    expect(html).not.toContain('pixel@track.test');
    expect(html).not.toContain('gmail_signature');
    expect(html).not.toContain('data:image/');
    expect(html).not.toContain('/v1/c/a/');
  });

  it('is idempotent on a redelivered message: no duplicate attachment rows', async () => {
    const before = await db
      .select()
      .from(schema.convAttachments)
      .where(eq(schema.convAttachments.orgId, orgId));
    const eml = buildEml({
      from: 'Customer One <c1@customer.test>',
      to: 'support@acme.test',
      subject: 'Broken widget — photo attached',
      messageId: 'img-inbound-1@customer.test',
      text: 'The widget arrived cracked.',
      html: '<p>The widget arrived cracked.</p>',
      parts: [
        {
          contentType: 'image/jpeg',
          disposition: 'attachment',
          filename: 'cracked-widget.jpg',
          content: photo,
        },
      ],
    });
    await adapter.ingest(channel, await parseMessage(eml));
    const after = await db
      .select()
      .from(schema.convAttachments)
      .where(eq(schema.convAttachments.orgId, orgId));
    expect(after).toHaveLength(before.length);
  });

  it('sends an outbound reply with the image as real bytes, never a signed url', async () => {
    mailer.clear();
    const conversations = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));
    const conversationId = conversations[0]!.id;

    const [reply] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'user',
        authorId: 'usr_agent',
        body: 'Here is the replacement label.',
      })
      .returning();

    const label = await noisyImage(300, 200, 'png');
    const actor = new ActorIdentity('system', 'email-image-test', orgId, ['*'], ['admin']);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        const dto = await attachments.persistBytes({
          conversationId,
          messageId: reply!.id,
          name: 'replacement-label.png',
          mime: 'image/png',
          body: label,
        });
        await tx
          .update(schema.convMessages)
          .set({ attachments: attachments.projectForMessage([dto]) })
          .where(eq(schema.convMessages.id, reply!.id));
      });
    });

    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId: reply!.id,
      channelId: channel.id,
      status: 'queued',
      attempt: 0,
      nextAttemptAt: new Date(),
    });

    const drain = await outboundWorker.tick();
    expect(drain.sent).toBe(1);
    expect(mailer.outbox).toHaveLength(1);

    const sent = mailer.outbox[0]!;
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments![0]!.filename).toBe('replacement-label.png');
    expect(sent.attachments![0]!.contentType).toBe('image/png');
    expect(sent.attachments![0]!.content.equals(label)).toBe(true);
    expect(sent.text ?? '').not.toContain('/v1/c/a/');
    expect(sent.html ?? '').not.toContain('/v1/c/a/');
  });

  it('omits a tombstoned attachment from the outbound message rather than failing the send', async () => {
    mailer.clear();
    const conversations = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));
    const conversationId = conversations[0]!.id;

    const [reply] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'user',
        authorId: 'usr_agent',
        body: 'Second try.',
      })
      .returning();

    const actor = new ActorIdentity('system', 'email-image-test', orgId, ['*'], ['admin']);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        const dto = await attachments.persistBytes({
          conversationId,
          messageId: reply!.id,
          name: 'doomed.png',
          mime: 'image/png',
          body: await noisyImage(120, 120, 'png'),
        });
        await tx
          .update(schema.convMessages)
          .set({ attachments: attachments.projectForMessage([dto]) })
          .where(eq(schema.convMessages.id, reply!.id));
        await attachments.delete({ id: dto.id });
      });
    });

    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId: reply!.id,
      channelId: channel.id,
      status: 'queued',
      attempt: 0,
      nextAttemptAt: new Date(),
    });

    const drain = await outboundWorker.tick();
    expect(drain.sent).toBe(1);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]!.attachments ?? []).toHaveLength(0);

    const tombstoned = await db
      .select()
      .from(schema.convAttachments)
      .where(
        and(eq(schema.convAttachments.orgId, orgId), eq(schema.convAttachments.name, 'doomed.png')),
      );
    expect(tombstoned).toHaveLength(1);
    expect(tombstoned[0]!.deletedAt).not.toBeNull();
    expect(tombstoned[0]!.storageKey).toBeNull();
  });
});
