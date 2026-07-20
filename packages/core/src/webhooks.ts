import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from './request/context.ts';
import { signHmac } from './crypto/primitives.ts';

export interface WebhookEventInput {
  type: string;
  payload: Record<string, unknown>;
  /** Loop-prevention. Carry forward when re-emitting events from a webhook handler. */
  hopCount?: number;
}

export interface EmittedEvent {
  eventId: string;
  orgId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * A delivery sink invoked synchronously inside `emit()` — i.e. inside the
 * request's tenant transaction (`getCurrentContext().db`). Sinks enqueue
 * durable work (queue-table inserts) transactionally with the event; the
 * actual external I/O belongs in an out-of-band worker. The webhooks queue
 * is the built-in sink; integrations (Slack, …) register additional ones.
 */
export interface EventSink {
  onEvent(event: EmittedEvent): Promise<void>;
}

/**
 * Records a domain event in the `events` table and queues delivery to
 * every active webhook in the org subscribed to this event type.
 *
 * Delivery is fire-and-forget here; an out-of-band worker (M2+) drains the
 * `webhook_deliveries` table with retries. For v0.4 we run the worker
 * in-process via a setInterval (good enough for a solo-dev MVP).
 */
export class WebhookDispatcher {
  private readonly sinks: EventSink[] = [];

  registerSink(sink: EventSink): void {
    this.sinks.push(sink);
  }

  async emit(input: WebhookEventInput): Promise<string> {
    const ctx = getCurrentContext();
    if (!ctx.actor) throw new Error('webhooks.emit requires an authenticated actor');
    const orgId = ctx.actor.orgId;

    const hopCount = input.hopCount ?? 0;
    if (hopCount >= 10) {
      throw new Error(`event hop count exceeded for ${input.type} (correlationId=${ctx.correlationId})`);
    }

    const [event] = await ctx.db
      .insert(schema.events)
      .values({
        orgId,
        type: input.type,
        actorId: ctx.actor.id,
        correlationId: ctx.correlationId,
        hopCount,
        payload: input.payload,
      })
      .returning({ id: schema.events.id });

    const eventId = event!.id;

    const subs = await ctx.db
      .select()
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.active, true)));

    const matching = subs.filter(
      (w) => w.events.length === 0 || w.events.includes(input.type),
    );

    if (matching.length > 0) {
      await ctx.db.insert(schema.webhookDeliveries).values(
        matching.map((w) => ({
          webhookId: w.id,
          eventId,
          nextAttemptAt: new Date(),
        })),
      );
    }

    for (const sink of this.sinks) {
      await sink.onEvent({ eventId, orgId, type: input.type, payload: input.payload });
    }

    return eventId;
  }

  /**
   * Build the canonical payload + signature header pair for a delivery.
   * Used by the worker; exposed here so callers (and tests) can replay.
   */
  static buildSignedRequest(
    eventType: string,
    eventPayload: Record<string, unknown>,
    secret: string,
  ): { body: string; signature: string } {
    const body = JSON.stringify({ type: eventType, ...eventPayload });
    const signature = `sha256=${signHmac(body, secret)}`;
    return { body, signature };
  }
}
