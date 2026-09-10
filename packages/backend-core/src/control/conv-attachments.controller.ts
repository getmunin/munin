import { Get, Inject, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import {
  AttachmentTokenError,
  verifyAttachmentToken,
  type AssetStorage,
} from '@getmunin/core';
import { sql } from 'drizzle-orm';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { STORAGE } from '../common/storage/storage.token.ts';

@PublicController('v1/c/a', { throttle: true })
export class ConvAttachmentsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: AssetStorage,
  ) {}

  @Get(':token')
  async serve(
    @Param('token') token: string,
    @Res() res: Response,
    @Query('w') widthParam?: string,
  ): Promise<void> {
    let payload;
    try {
      payload = verifyAttachmentToken(token);
    } catch (err) {
      if (err instanceof AttachmentTokenError) throw new NotFoundException();
      throw err;
    }

    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx
        .select({
          mime: schema.convAttachments.mime,
          storageKey: schema.convAttachments.storageKey,
          variants: schema.convAttachments.variants,
          name: schema.convAttachments.name,
        })
        .from(schema.convAttachments)
        .where(
          and(
            eq(schema.convAttachments.id, payload.attachmentId),
            eq(schema.convAttachments.orgId, payload.orgId),
            eq(schema.convAttachments.uploaded, true),
            isNull(schema.convAttachments.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });

    if (!row || !row.storageKey) throw new NotFoundException();

    const requestedWidth = widthParam ? Number(widthParam) : null;
    const variant =
      requestedWidth && Number.isFinite(requestedWidth)
        ? row.variants.find((v) => v.width === requestedWidth)
        : undefined;

    const key = variant?.storageKey ?? row.storageKey;
    const mime = variant ? 'image/webp' : row.mime;
    const bytes = await this.storage.readBytes(key);
    if (!bytes) throw new NotFoundException();

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(row.name)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).end(bytes);
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'attachment';
}
