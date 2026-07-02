import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, isNull, lt, lte } from 'drizzle-orm';
import {
  describeError,
  parseEnvDisableFlag,
  parseEnvInt,
  safeFetch,
  WebhookDispatcher,
} from '@getmunin/core';
import { DB } from '../db/db.module.ts';
import { withSchedulerLock } from '../scheduler-lock/index.ts';

const POLL_INTERVAL_MS = parseEnvInt({ name: 'MUNIN_WEBHOOK_POLL_MS', default: 5000 });
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const BACKOFF_BASE_MS = 30_000; // 30s, then 1m, 2m, 4m, 8m for ~16m total span.

/**
 * In-process webhook delivery worker. Polls `webhook_deliveries` for rows
 * whose `next_attempt_at <= now()` and that haven't yet succeeded, POSTs
 * the signed payload to the webhook URL, and updates the row with the
 * outcome (success → `delivered_at`; failure → bump `attempt`, push
 * `next_attempt_at` forward with exponential backoff).
 *
 * Service-role DB so the worker can read deliveries across orgs without
 * a tenant context. RLS doesn't apply, but every query already filters
 * by webhook_id / org_id transitively, and the worker is internal.
 *
 * One worker instance per backend process is fine for v0.4. If we ever
 * scale horizontally, swap the polling claim for SELECT ... FOR UPDATE
 * SKIP LOCKED or an external queue.
 */
@Injectable()
export class WebhookWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    parseEnvDisableFlag('MUNIN_WEBHOOK_WORKER_DISABLED') ||
    process.env.NODE_ENV === 'test';

  constructor(@Inject(DB) private readonly db: Db) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'webhook-worker', () => this.tick());
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Drain a batch of due deliveries. Public so tests can call it directly
   * without waiting on the polling interval.
   */
  async tick(): Promise<{ attempted: number; delivered: number; failed: number }> {
    if (this.running) return { attempted: 0, delivered: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<{ attempted: number; delivered: number; failed: number }> {
    const now = new Date();
    const rows = await this.db
      .select({
        id: schema.webhookDeliveries.id,
        webhookId: schema.webhookDeliveries.webhookId,
        eventId: schema.webhookDeliveries.eventId,
        attempt: schema.webhookDeliveries.attempt,
      })
      .from(schema.webhookDeliveries)
      .where(
        and(
          isNull(schema.webhookDeliveries.deliveredAt),
          lt(schema.webhookDeliveries.attempt, MAX_ATTEMPTS),
          lte(schema.webhookDeliveries.nextAttemptAt, now),
        ),
      )
      .limit(BATCH_SIZE);

    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await this.attemptOne(row.id, row.webhookId, row.eventId, row.attempt);
      if (result === 'delivered') delivered += 1;
      else failed += 1;
    }
    return { attempted: rows.length, delivered, failed };
  }

  private async attemptOne(
    deliveryId: string,
    webhookId: string,
    eventId: string,
    priorAttempts: number,
  ): Promise<'delivered' | 'failed'> {
    const [webhookRow] = await this.db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, webhookId))
      .limit(1);
    const [eventRow] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!webhookRow || !eventRow || !webhookRow.active) {
      // Webhook gone or disabled — mark delivered to stop retrying.
      await this.db
        .update(schema.webhookDeliveries)
        .set({
          deliveredAt: new Date(),
          error: webhookRow?.active === false ? 'webhook_disabled' : 'webhook_or_event_missing',
        })
        .where(eq(schema.webhookDeliveries.id, deliveryId));
      return 'failed';
    }

    const { body, signature, timestamp } = WebhookDispatcher.buildSignedRequest(
      eventRow.type,
      {
        id: eventRow.id,
        orgId: eventRow.orgId,
        correlationId: eventRow.correlationId,
        createdAt: eventRow.createdAt.toISOString(),
        payload: eventRow.payload,
      },
      webhookRow.secret,
    );

    const start = Date.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await safeFetch(webhookRow.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-munin-signature': signature,
          'x-munin-timestamp': timestamp,
          'x-munin-event': eventRow.type,
          'x-munin-delivery-id': deliveryId,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      statusCode = res.status;
      if (!res.ok) error = `non-2xx: ${res.status}`;
    } catch (err) {
      error = describeError(err);
    }
    const durationMs = Date.now() - start;

    if (error === null) {
      await this.db
        .update(schema.webhookDeliveries)
        .set({
          attempt: priorAttempts + 1,
          statusCode,
          durationMs,
          deliveredAt: new Date(),
          error: null,
        })
        .where(eq(schema.webhookDeliveries.id, deliveryId));
      return 'delivered';
    }

    const nextAttempt = priorAttempts + 1;
    const final = nextAttempt >= MAX_ATTEMPTS;
    const backoff = BACKOFF_BASE_MS * 2 ** priorAttempts;
    const jitter = Math.floor(backoff * 0.1 * Math.random());
    await this.db
      .update(schema.webhookDeliveries)
      .set({
        attempt: nextAttempt,
        statusCode,
        durationMs,
        error,
        nextAttemptAt: final ? null : new Date(Date.now() + backoff + jitter),
        deliveredAt: final ? new Date() : null,
      })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    return 'failed';
  }
}

// Exported for tests to clamp polling.
export { POLL_INTERVAL_MS };
