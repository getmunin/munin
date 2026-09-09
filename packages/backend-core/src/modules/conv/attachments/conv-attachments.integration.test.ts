import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { ActorIdentity, signAttachmentToken, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { createApp } from '../../../bootstrap-app.ts';
import { AppModule } from '../../../app.module.ts';
import { ConvAttachmentsService } from './conv-attachments.service.ts';
import { CONV_ATTACHMENT_PENDING_PER_SESSION_MAX } from './conv-attachments.constants.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run conv attachment integration tests.';

(skipReason ? describe.skip : describe)('conv attachments: store, serve, delete', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let service: ConvAttachmentsService;
  let storageDir: string;
  let orgA: string;
  let orgB: string;
  let convA: string;
  let convB: string;
  let messageA: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    storageDir = await mkdtemp(join(tmpdir(), 'munin-conv-att-test-'));
    process.env.MUNIN_STORAGE_LOCAL_PATH = storageDir;
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:1/static/assets';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    appDb = createDb(appUrl);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [a] = await db.insert(schema.orgs).values({ name: 'Att Org A' }).returning();
    const [b] = await db.insert(schema.orgs).values({ name: 'Att Org B' }).returning();
    orgA = a!.id;
    orgB = b!.id;

    convA = await seedConversation(orgA, 'A');
    convB = await seedConversation(orgB, 'B');

    const [msg] = await db
      .insert(schema.convMessages)
      .values({
        orgId: orgA,
        conversationId: convA,
        authorType: 'user',
        authorId: 'usr_test',
        body: 'here you go',
      })
      .returning();
    messageA = msg!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
    service = app.get(ConvAttachmentsService);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      for (const id of [orgA, orgB]) {
        if (id) await db.delete(schema.orgs).where(sql`id = ${id}`);
      }
    }
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  async function seedConversation(orgId: string, tag: string): Promise<string> {
    const [channel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'widget',
        name: `widget-${tag}`,
        config: { provider: 'widget' },
        active: true,
      })
      .returning();
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: `att-${tag}@example.com`, name: `Att ${tag}` })
      .returning();
    const next = await db.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: next[0]!.next,
        channelId: channel!.id,
        contactId: contact!.id,
        status: 'open',
        lastMessageAt: new Date(),
      })
      .returning();
    return conv!.id;
  }

  function asAdmin<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function pngBytes(width: number, height = 400): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: { r: 20, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
  }

  async function uploadThroughPresignedUrl(uploadUrl: string, body: Buffer): Promise<Response> {
    const rewritten = uploadUrl.replace(/^http:\/\/127\.0\.0\.1:1/, baseUrl);
    return fetch(rewritten, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': 'image/png' },
    });
  }

  it('presigned round-trip stores the image, derives variants, and serves it over a signed URL', async () => {
    const body = await pngBytes(1200);
    const dto = await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'screenshot.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      expect(handle.uploaded).toBe(false);
      const res = await uploadThroughPresignedUrl(handle.uploadUrl, body);
      expect(res.status).toBe(204);
      return service.completeUpload({ id: handle.id });
    });

    expect(dto.uploaded).toBe(true);
    expect(dto.width).toBe(1200);
    expect(dto.height).toBe(400);
    expect(dto.url).toBeTruthy();
    expect(dto.thumbnailUrl).toBeTruthy();

    const served = await fetch(dto.url!.replace(/^https?:\/\/[^/]+/, baseUrl));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Number(served.headers.get('content-length'))).toBe(body.length);

    const thumb = await fetch(dto.thumbnailUrl!.replace(/^https?:\/\/[^/]+/, baseUrl));
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    expect(Number(thumb.headers.get('content-length'))).toBeLessThan(body.length);
  });

  it('rejects a completeUpload whose object size does not match what was declared', async () => {
    const body = await pngBytes(600);
    await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'short.png',
        mime: 'image/png',
        sizeBytes: body.length + 500,
      });
      const res = await uploadThroughPresignedUrl(handle.uploadUrl, body);
      expect(res.status).toBe(400);
      await expect(service.completeUpload({ id: handle.id })).rejects.toThrow(
        /conv_attachment_upload_missing/,
      );
    });
  });

  it('rejects svg at the boundary', async () => {
    await expect(
      asAdmin(orgA, () =>
        service.requestUpload({
          conversationId: convA,
          name: 'logo.svg',
          mime: 'image/svg+xml',
          sizeBytes: 100,
        }),
      ),
    ).rejects.toThrow(/conv_attachment_mime_rejected/);
  });

  it('rejects a non-image type at the boundary', async () => {
    await expect(
      asAdmin(orgA, () =>
        service.requestUpload({
          conversationId: convA,
          name: 'invoice.pdf',
          mime: 'application/pdf',
          sizeBytes: 100,
        }),
      ),
    ).rejects.toThrow(/conv_attachment_mime_rejected/);
  });

  it('rejects an upload request for a conversation that does not exist', async () => {
    await expect(
      asAdmin(orgA, () =>
        service.requestUpload({
          conversationId: 'ccv_nope',
          name: 'a.png',
          mime: 'image/png',
          sizeBytes: 10,
        }),
      ),
    ).rejects.toThrow(/conv_not_found/);
  });

  it('caps pending uploads per widget session', async () => {
    const sessionId = `sess-${randomUUID()}`;
    for (let i = 0; i < CONV_ATTACHMENT_PENDING_PER_SESSION_MAX; i += 1) {
      await asAdmin(orgA, () =>
        service.requestUpload({
          conversationId: convA,
          name: `p${i}.png`,
          mime: 'image/png',
          sizeBytes: 1000,
          sessionId,
        }),
      );
    }
    await expect(
      asAdmin(orgA, () =>
        service.requestUpload({
          conversationId: convA,
          name: 'one-too-many.png',
          mime: 'image/png',
          sizeBytes: 1000,
          sessionId,
        }),
      ),
    ).rejects.toThrow(/conv_attachment_too_many/);
  });

  it('refuses to attach an upload that was never completed', async () => {
    const body = await pngBytes(400);
    const pendingId = await asAdmin(orgA, async () => {
      const pending = await service.requestUpload({
        conversationId: convA,
        name: 'pending.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      return pending.id;
    });
    await expect(
      asAdmin(orgA, () =>
        service.attachToMessage({
          messageId: messageA,
          conversationId: convA,
          attachmentIds: [pendingId],
        }),
      ),
    ).rejects.toThrow(/upload was never completed/);
  });

  it('refuses to attach an upload belonging to another conversation', async () => {
    const body = await pngBytes(400);
    const pendingId = await asAdmin(orgA, async () => {
      const pending = await service.requestUpload({
        conversationId: convA,
        name: 'other-conv.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      return pending.id;
    });
    await expect(
      asAdmin(orgA, () =>
        service.attachToMessage({
          messageId: messageA,
          conversationId: convB,
          attachmentIds: [pendingId],
        }),
      ),
    ).rejects.toThrow(/belongs to another conversation/);
  });

  it('refuses to move an attachment already committed to another message', async () => {
    const body = await pngBytes(400);
    const attachmentId = await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'committed.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      await uploadThroughPresignedUrl(handle.uploadUrl, body);
      await service.completeUpload({ id: handle.id });
      await service.attachToMessage({
        messageId: messageA,
        conversationId: convA,
        attachmentIds: [handle.id],
      });
      return handle.id;
    });

    const [other] = await db
      .insert(schema.convMessages)
      .values({
        orgId: orgA,
        conversationId: convA,
        authorType: 'user',
        authorId: 'usr_test',
        body: 'second',
      })
      .returning();
    await expect(
      asAdmin(orgA, () =>
        service.attachToMessage({
          messageId: other!.id,
          conversationId: convA,
          attachmentIds: [attachmentId],
        }),
      ),
    ).rejects.toThrow(/already on message/);
  });

  it('hard-deletes a pending upload and purges its object', async () => {
    const body = await pngBytes(500);
    await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'discard.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      await uploadThroughPresignedUrl(handle.uploadUrl, body);
      await service.completeUpload({ id: handle.id });

      const result = await service.delete({ id: handle.id });
      expect(result).toEqual({ deleted: true, id: handle.id, alreadyDeleted: false });
    });

    const rows = await db.execute<{ n: number } & Record<string, unknown>>(
      sql`SELECT count(*)::int AS n FROM conv_attachments WHERE name = 'discard.png'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('tombstones a sent attachment, purges master and variant objects, and stops serving it', async () => {
    const body = await pngBytes(1200);
    const { id, url, thumbnailUrl } = await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'sent.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      await uploadThroughPresignedUrl(handle.uploadUrl, body);
      const dto = await service.completeUpload({ id: handle.id });
      await service.attachToMessage({
        messageId: messageA,
        conversationId: convA,
        attachmentIds: [handle.id],
      });
      return { id: handle.id, url: dto.url!, thumbnailUrl: dto.thumbnailUrl! };
    });

    const [before] = await db.select().from(schema.convAttachments).where(sql`id = ${id}`);
    expect(before!.variants.length).toBeGreaterThan(0);
    expect(await fetch(url.replace(/^https?:\/\/[^/]+/, baseUrl)).then((r) => r.status)).toBe(200);

    await asAdmin(orgA, () => service.delete({ id }));

    const [row] = await db.execute<Record<string, unknown>>(
      sql`SELECT deleted_at, deleted_by_type, storage_key, variants, name, mime, size_bytes
          FROM conv_attachments WHERE id = ${id}`,
    );
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.deleted_by_type).toBe('user');
    expect(row!.storage_key).toBeNull();
    expect(row!.variants).toEqual([]);
    expect(row!.name).toBe('sent.png');
    expect(Number(row!.size_bytes)).toBe(body.length);

    expect(await fetch(url.replace(/^https?:\/\/[^/]+/, baseUrl)).then((r) => r.status)).toBe(404);
    expect(
      await fetch(thumbnailUrl.replace(/^https?:\/\/[^/]+/, baseUrl)).then((r) => r.status),
    ).toBe(404);

    const rows = await db.select().from(schema.convAttachments).where(sql`id = ${id}`);
    const dto = service.toDto(rows[0]!);
    expect(dto.deleted).toBe(true);
    expect(dto.url).toBeNull();
    expect(dto.thumbnailUrl).toBeNull();
  });

  it('re-deleting a tombstone is idempotent rather than a 404', async () => {
    const body = await pngBytes(400);
    const id = await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'twice.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      await uploadThroughPresignedUrl(handle.uploadUrl, body);
      await service.completeUpload({ id: handle.id });
      await service.attachToMessage({
        messageId: messageA,
        conversationId: convA,
        attachmentIds: [handle.id],
      });
      await service.delete({ id: handle.id });
      return handle.id;
    });
    const again = await asAdmin(orgA, () => service.delete({ id }));
    expect(again).toEqual({ deleted: true, id, alreadyDeleted: true });
  });

  it('does not serve an attachment on a token minted for another org', async () => {
    const body = await pngBytes(400);
    const id = await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'tenant.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      await uploadThroughPresignedUrl(handle.uploadUrl, body);
      await service.completeUpload({ id: handle.id });
      return handle.id;
    });

    const foreign = signAttachmentToken({ orgId: orgB, attachmentId: id });
    expect(await fetch(`${baseUrl}/v1/c/a/${foreign}`).then((r) => r.status)).toBe(404);
    expect(await fetch(`${baseUrl}/v1/c/a/not-a-token`).then((r) => r.status)).toBe(404);
  });

  it('isolates attachments across orgs under RLS', async () => {
    const body = await pngBytes(400);
    const id = await asAdmin(orgA, async () => {
      const handle = await service.requestUpload({
        conversationId: convA,
        name: 'private.png',
        mime: 'image/png',
        sizeBytes: body.length,
      });
      await uploadThroughPresignedUrl(handle.uploadUrl, body);
      await service.completeUpload({ id: handle.id });
      return handle.id;
    });

    await expect(asAdmin(orgB, () => service.completeUpload({ id }))).rejects.toThrow(
      /conv_not_found/,
    );
    await expect(asAdmin(orgB, () => service.delete({ id }))).rejects.toThrow(/conv_not_found/);
  });
});
