import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import { ActorIdentity, getCurrentContext, withContext, type RequestContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { resultRows } from './rows.ts';

export const PII_WORKER_ACTOR_ID = 'pii-annotation-worker';
export const PII_MAX_CLAIM_TEXT = 100_000;
export const PII_MAX_SURFACE_LENGTH = 120;

export interface ClaimAnnotationsInput {
  detectorVersion: number;
  limit: number;
  leaseSeconds: number;
  holder: string;
}

export interface ClaimedMessage {
  messageId: string;
  text: string;
}

export interface SubmittedSpan {
  start: number;
  end: number;
  text: string;
  source: string;
}

export interface SubmitAnnotationsInput {
  holder: string;
  detectorVersion: number;
  detector: string;
  results: ReadonlyArray<{ messageId: string; spans: readonly SubmittedSpan[] }>;
}

export interface SubmitAnnotationsResult {
  accepted: number;
  spans: number;
  rejected: Array<{ messageId: string; reason: 'unknown_message' | 'lease_lost' }>;
}

export interface MessageCoverage {
  total: number;
  annotated: number;
}

@Injectable()
export class PiiAnnotationsService {
  private readonly logger = new Logger(PiiAnnotationsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async claim(input: ClaimAnnotationsInput): Promise<{ items: ClaimedMessage[] }> {
    const items: ClaimedMessage[] = [];
    for (const orgId of await this.orgIdsInRandomOrder()) {
      const remaining = input.limit - items.length;
      if (remaining <= 0) break;
      const claimed = await this.inOrg(orgId, (tx) => this.claimForOrg(tx, orgId, input, remaining));
      items.push(...claimed);
    }
    return { items };
  }

  async submit(input: SubmitAnnotationsInput): Promise<SubmitAnnotationsResult> {
    const result: SubmitAnnotationsResult = { accepted: 0, spans: 0, rejected: [] };
    if (input.results.length === 0) return result;

    const owners = await this.db
      .select({
        messageId: schema.piiMessageAnnotations.messageId,
        orgId: schema.piiMessageAnnotations.orgId,
      })
      .from(schema.piiMessageAnnotations)
      .where(
        inArray(
          schema.piiMessageAnnotations.messageId,
          input.results.map((r) => r.messageId),
        ),
      );
    const orgByMessage = new Map(owners.map((o) => [o.messageId, o.orgId]));

    const byOrg = new Map<string, Array<SubmitAnnotationsInput['results'][number]>>();
    for (const entry of input.results) {
      const orgId = orgByMessage.get(entry.messageId);
      if (!orgId) {
        result.rejected.push({ messageId: entry.messageId, reason: 'unknown_message' });
        continue;
      }
      const bucket = byOrg.get(orgId);
      if (bucket) bucket.push(entry);
      else byOrg.set(orgId, [entry]);
    }

    for (const [orgId, entries] of byOrg) {
      const outcome = await this.inOrg(orgId, (tx) => this.submitForOrg(tx, orgId, input, entries));
      result.accepted += outcome.accepted;
      result.spans += outcome.spans;
      result.rejected.push(...outcome.rejected);
    }
    if (result.accepted > 0) {
      this.logger.log(
        `stored ${result.spans} span(s) for ${result.accepted} message(s) at detector v${input.detectorVersion}`,
      );
    }
    return result;
  }

  async coverage(messageIds: readonly string[]): Promise<MessageCoverage> {
    const unique = [...new Set(messageIds)];
    if (unique.length === 0) return { total: 0, annotated: 0 };
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ messageId: schema.piiMessageAnnotations.messageId })
      .from(schema.piiMessageAnnotations)
      .where(
        and(
          inArray(schema.piiMessageAnnotations.messageId, unique),
          isNotNull(schema.piiMessageAnnotations.nerVersion),
        ),
      );
    return { total: unique.length, annotated: rows.length };
  }

  async uncheckedSubjects(
    messageIds: readonly string[],
    conversationIds: readonly string[],
  ): Promise<{ messages: Set<string>; conversations: Set<string> }> {
    const ctx = getCurrentContext();
    const messages = new Set<string>();
    const conversations = new Set<string>();
    if (messageIds.length > 0) {
      const checked = await ctx.db
        .select({ messageId: schema.piiMessageAnnotations.messageId })
        .from(schema.piiMessageAnnotations)
        .where(
          and(
            inArray(schema.piiMessageAnnotations.messageId, [...messageIds]),
            isNotNull(schema.piiMessageAnnotations.nerVersion),
          ),
        );
      const done = new Set(checked.map((r) => r.messageId));
      for (const id of messageIds) if (!done.has(id)) messages.add(id);
    }
    if (conversationIds.length > 0) {
      const rows = await ctx.db
        .selectDistinct({ conversationId: schema.convMessages.conversationId })
        .from(schema.convMessages)
        .leftJoin(
          schema.piiMessageAnnotations,
          and(
            eq(schema.piiMessageAnnotations.messageId, schema.convMessages.id),
            isNotNull(schema.piiMessageAnnotations.nerVersion),
          ),
        )
        .where(
          and(
            inArray(schema.convMessages.conversationId, [...conversationIds]),
            isNull(schema.piiMessageAnnotations.messageId),
          ),
        );
      for (const row of rows) conversations.add(row.conversationId);
    }
    return { messages, conversations };
  }

  private async claimForOrg(
    tx: Tx,
    orgId: string,
    input: ClaimAnnotationsInput,
    remaining: number,
  ): Promise<ClaimedMessage[]> {
    await tx.execute(sql`
      INSERT INTO pii_message_annotations (message_id, org_id)
      SELECT m.id, m.org_id FROM conv_messages m
      WHERE m.org_id = ${orgId}
        AND NOT EXISTS (SELECT 1 FROM pii_message_annotations a WHERE a.message_id = m.id)
      ORDER BY m.created_at DESC
      LIMIT ${remaining}
      ON CONFLICT (message_id) DO NOTHING
    `);
    const leased = await tx.execute(sql`
      WITH picked AS (
        SELECT a.message_id FROM pii_message_annotations a
        JOIN conv_messages m ON m.id = a.message_id
        WHERE a.org_id = ${orgId}
          AND (a.ner_version IS NULL OR a.ner_version < ${input.detectorVersion})
          AND (a.lease_expires_at IS NULL OR a.lease_expires_at < now())
        ORDER BY m.created_at DESC
        LIMIT ${remaining}
        FOR UPDATE OF a SKIP LOCKED
      )
      UPDATE pii_message_annotations a
      SET lease_holder = ${input.holder},
          lease_expires_at = now() + make_interval(secs => ${input.leaseSeconds}),
          updated_at = now()
      FROM picked, conv_messages m
      WHERE a.message_id = picked.message_id AND m.id = a.message_id
      RETURNING a.message_id, m.body
    `);
    return resultRows<{ message_id: string; body: string }>(leased).map((row) => ({
      messageId: row.message_id,
      text: row.body.slice(0, PII_MAX_CLAIM_TEXT),
    }));
  }

  private async submitForOrg(
    tx: Tx,
    orgId: string,
    input: SubmitAnnotationsInput,
    entries: ReadonlyArray<SubmitAnnotationsInput['results'][number]>,
  ): Promise<SubmitAnnotationsResult> {
    const outcome: SubmitAnnotationsResult = { accepted: 0, spans: 0, rejected: [] };
    const leased = await tx
      .select({
        messageId: schema.piiMessageAnnotations.messageId,
        body: schema.convMessages.body,
      })
      .from(schema.piiMessageAnnotations)
      .innerJoin(schema.convMessages, eq(schema.convMessages.id, schema.piiMessageAnnotations.messageId))
      .where(
        and(
          inArray(
            schema.piiMessageAnnotations.messageId,
            entries.map((e) => e.messageId),
          ),
          eq(schema.piiMessageAnnotations.leaseHolder, input.holder),
          or(
            isNull(schema.piiMessageAnnotations.nerVersion),
            lt(schema.piiMessageAnnotations.nerVersion, input.detectorVersion),
          ),
        ),
      )
      .for('update', { of: schema.piiMessageAnnotations });
    const bodyByMessage = new Map(leased.map((row) => [row.messageId, row.body]));

    const accepted: string[] = [];
    const spanRows: Array<typeof schema.piiSpans.$inferInsert> = [];
    for (const entry of entries) {
      const body = bodyByMessage.get(entry.messageId);
      if (body === undefined) {
        outcome.rejected.push({ messageId: entry.messageId, reason: 'lease_lost' });
        continue;
      }
      accepted.push(entry.messageId);
      for (const span of entry.spans) {
        const located = locateSpan(body, span);
        if (!located) continue;
        spanRows.push({
          orgId,
          messageId: entry.messageId,
          startOffset: located.start,
          endOffset: located.end,
          kind: 'person',
          surface: body.slice(located.start, located.end),
          source: span.source,
          detectorVersion: input.detectorVersion,
        });
      }
    }
    if (accepted.length === 0) return outcome;

    await tx.delete(schema.piiSpans).where(inArray(schema.piiSpans.messageId, accepted));
    if (spanRows.length > 0) await tx.insert(schema.piiSpans).values(spanRows);
    await tx
      .update(schema.piiMessageAnnotations)
      .set({
        nerVersion: input.detectorVersion,
        nerDetector: input.detector,
        annotatedAt: new Date(),
        leaseHolder: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(inArray(schema.piiMessageAnnotations.messageId, accepted));

    outcome.accepted = accepted.length;
    outcome.spans = spanRows.length;
    return outcome;
  }

  private async orgIdsInRandomOrder(): Promise<string[]> {
    const rows = await this.db.execute(sql`SELECT id FROM orgs ORDER BY random()`);
    return resultRows<{ id: string }>(rows).map((r) => r.id);
  }

  private async inOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor = new ActorIdentity('system', PII_WORKER_ACTOR_ID, orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, () => fn(tx));
    });
  }
}

export function locateSpan(
  body: string,
  span: Pick<SubmittedSpan, 'start' | 'end' | 'text'>,
): { start: number; end: number } | null {
  const text = span.text;
  if (!text.trim() || text.length > PII_MAX_SURFACE_LENGTH) return null;
  if (body.slice(span.start, span.end) === text) return { start: span.start, end: span.end };
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = body.indexOf(text); i !== -1; i = body.indexOf(text, i + 1)) {
    const distance = Math.abs(i - span.start);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best === -1 ? null : { start: best, end: best + text.length };
}
