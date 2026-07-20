import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import { SLACK_MIRRORED_EVENT_TYPES } from './slack.constants.ts';

/**
 * Registered on the WebhookDispatcher; runs inside the emitting request's
 * tenant transaction, so the queue row commits (or rolls back) together with
 * the event itself. Only enqueues — the bridge worker does the Slack I/O.
 */
@Injectable()
export class SlackEventSink implements EventSink {
  async onEvent(event: EmittedEvent): Promise<void> {
    if (!SLACK_MIRRORED_EVENT_TYPES.includes(event.type)) return;
    const ctx = getCurrentContext();
    const [integration] = await ctx.db
      .select({ id: schema.slackIntegrations.id })
      .from(schema.slackIntegrations)
      .where(
        and(
          eq(schema.slackIntegrations.orgId, event.orgId),
          eq(schema.slackIntegrations.active, true),
        ),
      )
      .limit(1);
    if (!integration) return;

    const conversationId =
      typeof event.payload.conversationId === 'string' ? event.payload.conversationId : null;
    await ctx.db.insert(schema.slackDeliveries).values({
      orgId: event.orgId,
      integrationId: integration.id,
      eventId: event.eventId,
      eventType: event.type,
      conversationId,
      nextAttemptAt: new Date(),
    });
  }
}
