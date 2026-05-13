import { Controller, Get, Inject, Param, Res, Headers } from '@nestjs/common';
import type { Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import {
  ActorIdentity,
  EmailOpenTokenError,
  WebhookDispatcher,
  verifyEmailOpenToken,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { AllowAnonymous } from '../common/auth/auth.guard.js';
import { DB } from '../common/db/db.module.js';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

const BOT_UA = /\b(bot|crawler|spider|preview|linkcheck|monitor)\b/i;

@Controller('api/v1/c/o')
export class EmailOpensController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  @Get(':token.gif')
  @AllowAnonymous()
  async open(
    @Param('token') token: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    sendPixel(res);
    if (!token) return;
    if (userAgent && BOT_UA.test(userAgent)) return;

    let payload;
    try {
      payload = verifyEmailOpenToken(token);
    } catch (err) {
      if (err instanceof EmailOpenTokenError) return;
      throw err;
    }

    try {
      const updated = await this.db
        .update(schema.convMessageDeliveries)
        .set({
          firstOpenedAt: sql`COALESCE(${schema.convMessageDeliveries.firstOpenedAt}, NOW())`,
          lastOpenedAt: sql`NOW()`,
          openCount: sql`${schema.convMessageDeliveries.openCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.convMessageDeliveries.id, payload.deliveryId))
        .returning({
          messageId: schema.convMessageDeliveries.messageId,
          openCount: schema.convMessageDeliveries.openCount,
          firstOpenedAt: schema.convMessageDeliveries.firstOpenedAt,
        });

      const row = updated[0];
      if (!row) return;
      if (row.openCount > 1) return;

      const actor = new ActorIdentity('system', 'email-open-tracker', payload.orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: this.db, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        await this.webhooks.emit({
          type: 'conversation.message.opened',
          payload: {
            deliveryId: payload.deliveryId,
            messageId: row.messageId,
            firstOpenedAt: row.firstOpenedAt?.toISOString() ?? null,
          },
        });
      });
    } catch {
      // Open tracking is best-effort — swallow DB / webhook errors so the
      // mail client never sees a broken image.
    }
  }
}

function sendPixel(res: Response): void {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(TRANSPARENT_GIF.length));
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).end(TRANSPARENT_GIF);
}
