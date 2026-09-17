import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { WebhookDispatcher, getCurrentContext } from '@getmunin/core';
import { encodeCursor, decodeCursor } from '../../common/transfer/transfer.helpers.ts';
import { applyInboundRedaction } from './inbound-redaction.ts';
import { readRedactionPolicy } from './redaction-policy.ts';

export interface RedactBackfillResult {
  scanned: number;
  messagesRewritten: number;
  subjectsRewritten: number;
  nextCursor: string | null;
  done: boolean;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

@Injectable()
export class RedactBackfillService {
  private readonly logger = new Logger(RedactBackfillService.name);

  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  async run(input: { limit?: number; cursor?: string } = {}): Promise<RedactBackfillResult> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const policy = await readRedactionPolicy(ctx.db, orgId);
    if (policy.policy === 'off' || policy.detectors.length === 0) {
      throw new BadRequestException(
        'conv_redaction_disabled: set a redaction policy before backfilling existing messages',
      );
    }

    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const after = decodeCursor(input.cursor);

    const rows = await ctx.db
      .select({
        id: schema.convMessages.id,
        conversationId: schema.convMessages.conversationId,
        authorType: schema.convMessages.authorType,
        internal: schema.convMessages.internal,
        body: schema.convMessages.body,
        bodyHtml: schema.convMessages.bodyHtml,
        metadata: schema.convMessages.metadata,
        createdAt: schema.convMessages.createdAt,
      })
      .from(schema.convMessages)
      .where(
        after
          ? and(
              eq(schema.convMessages.orgId, orgId),
              or(
                gt(schema.convMessages.createdAt, sql`${after.createdAt}::timestamptz`),
                and(
                  eq(schema.convMessages.createdAt, sql`${after.createdAt}::timestamptz`),
                  gt(schema.convMessages.id, sql`${after.id}::text`),
                ),
              ),
            )
          : eq(schema.convMessages.orgId, orgId),
      )
      .orderBy(asc(schema.convMessages.createdAt), asc(schema.convMessages.id))
      .limit(limit);

    let messagesRewritten = 0;
    const touchedConversations = new Set<string>();

    for (const row of rows) {
      const scrubbed = applyInboundRedaction(
        { body: row.body, bodyHtml: row.bodyHtml, metadata: row.metadata },
        policy,
      );
      if (!scrubbed.redacted) continue;

      await ctx.db
        .update(schema.convMessages)
        .set({
          body: scrubbed.fields.body,
          bodyHtml: scrubbed.fields.bodyHtml ?? null,
          metadata: scrubbed.fields.metadata ?? {},
        })
        .where(eq(schema.convMessages.id, row.id));
      messagesRewritten += 1;
      touchedConversations.add(row.conversationId);

      await this.webhooks.emit({
        type: 'conversation.message.body_revised',
        payload: {
          conversationId: row.conversationId,
          messageId: row.id,
          authorType: row.authorType,
          internal: row.internal,
          reason: 'national_id_redacted',
        },
      });
    }

    const subjectsRewritten = await this.rewriteSubjects(orgId, [...touchedConversations], policy);
    const last = rows[rows.length - 1];
    const done = rows.length < limit;

    this.logger.log(
      `redaction backfill org=${orgId} scanned=${rows.length} messages=${messagesRewritten} subjects=${subjectsRewritten} done=${done}`,
    );

    return {
      scanned: rows.length,
      messagesRewritten,
      subjectsRewritten,
      nextCursor: done || !last ? null : encodeCursor(last.createdAt, last.id),
      done,
    };
  }

  private async rewriteSubjects(
    orgId: string,
    conversationIds: string[],
    policy: Parameters<typeof applyInboundRedaction>[1],
  ): Promise<number> {
    if (conversationIds.length === 0) return 0;
    const ctx = getCurrentContext();
    let rewritten = 0;
    for (const conversationId of conversationIds) {
      const [conversation] = await ctx.db
        .select({ subject: schema.convConversations.subject })
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.orgId, orgId),
            eq(schema.convConversations.id, conversationId),
          ),
        )
        .limit(1);
      if (!conversation?.subject) continue;
      const scrubbed = applyInboundRedaction({ body: conversation.subject }, policy);
      if (!scrubbed.redacted) continue;
      await ctx.db
        .update(schema.convConversations)
        .set({ subject: scrubbed.fields.body })
        .where(eq(schema.convConversations.id, conversationId));
      rewritten += 1;
    }
    return rewritten;
  }
}
