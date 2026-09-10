import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, isNotNull, like, sql } from 'drizzle-orm';
import { describeError, getCurrentContext } from '@getmunin/core';
import { ConvAttachmentsService } from './conv-attachments.service.ts';
import { extractDataUriImages } from './inline-data-uri.ts';
import { parseMessageAttachmentProjection } from './conv-attachments.projection.ts';

export interface BackfillResult {
  scanned: number;
  converted: number;
  imagesExtracted: number;
  leftInline: number;
  failed: number;
}

@Injectable()
export class InlineImageBackfillService {
  private readonly logger = new Logger(InlineImageBackfillService.name);

  constructor(
    @Inject(ConvAttachmentsService) private readonly attachments: ConvAttachmentsService,
  ) {}

  async run(input: { limit?: number } = {}): Promise<BackfillResult> {
    const ctx = getCurrentContext();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .select({
        id: schema.convMessages.id,
        conversationId: schema.convMessages.conversationId,
        bodyHtml: schema.convMessages.bodyHtml,
        attachments: schema.convMessages.attachments,
      })
      .from(schema.convMessages)
      .where(
        and(
          isNotNull(schema.convMessages.bodyHtml),
          like(schema.convMessages.bodyHtml, '%data:image/%'),
        ),
      )
      .orderBy(schema.convMessages.createdAt)
      .limit(limit);

    const result: BackfillResult = {
      scanned: rows.length,
      converted: 0,
      imagesExtracted: 0,
      leftInline: 0,
      failed: 0,
    };

    for (const row of rows) {
      if (!row.bodyHtml) continue;
      const extraction = extractDataUriImages(row.bodyHtml, row.id);
      result.leftInline += extraction.skipped;
      if (extraction.images.length === 0) continue;

      try {
        const stored = [];
        for (const image of extraction.images) {
          stored.push(
            await this.attachments.persistBytes({
              conversationId: row.conversationId,
              messageId: row.id,
              name: image.name,
              mime: image.mime,
              body: image.body,
              inline: true,
              contentId: image.contentId,
            }),
          );
        }

        const existing = parseMessageAttachmentProjection(row.attachments);
        const projection = [...existing, ...this.attachments.projectForMessage(stored)];
        await ctx.db
          .update(schema.convMessages)
          .set({ bodyHtml: extraction.html, attachments: projection })
          .where(eq(schema.convMessages.id, row.id));

        result.converted += 1;
        result.imagesExtracted += stored.length;
      } catch (err) {
        result.failed += 1;
        this.logger.warn(`inline backfill failed for message ${row.id}: ${describeError(err)}`);
      }
    }

    return result;
  }

  async countRemaining(): Promise<number> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db.execute<{ n: number } & Record<string, unknown>>(sql`
      SELECT count(*)::int AS n FROM conv_messages
      WHERE body_html IS NOT NULL AND body_html LIKE '%data:image/%'
    `);
    return row?.n ?? 0;
  }
}
