import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import {
  SLACK_ANNOUNCEMENT_EVENT_TYPES,
  SLACK_APPROVAL_EVENT_TYPES,
  SLACK_MIRRORED_EVENT_TYPES,
  announcementSubjectRef,
  approvalSubjectRef,
} from './slack.constants.ts';

@Injectable()
export class SlackEventSink implements EventSink {
  async onEvent(event: EmittedEvent): Promise<void> {
    const isApproval = SLACK_APPROVAL_EVENT_TYPES.includes(event.type);
    const isAnnouncement = SLACK_ANNOUNCEMENT_EVENT_TYPES.includes(event.type);
    if (!isApproval && !isAnnouncement && !SLACK_MIRRORED_EVENT_TYPES.includes(event.type)) return;
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

    const subject = isApproval
      ? approvalSubjectRef(event.type, event.payload)
      : isAnnouncement
        ? announcementSubjectRef(event.type, event.payload)
        : null;
    if ((isApproval || isAnnouncement) && !subject) return;
    const conversationId =
      !isApproval && !isAnnouncement && typeof event.payload.conversationId === 'string'
        ? event.payload.conversationId
        : null;
    const order = await this.messageOrder(event);
    await ctx.db.insert(schema.slackDeliveries).values({
      orgId: event.orgId,
      integrationId: integration.id,
      eventId: event.eventId,
      eventType: event.type,
      conversationId,
      subjectKey: subject ? `${subject.subjectType}:${subject.subjectId}` : null,
      nextAttemptAt: new Date(),
      ...(order ? { orderAt: order.orderAt, orderSeq: order.orderSeq } : {}),
    });
  }

  private async messageOrder(
    event: EmittedEvent,
  ): Promise<{ orderAt: Date; orderSeq: number } | null> {
    const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : null;
    if (!messageId) return null;
    const ctx = getCurrentContext();
    const [message] = await ctx.db
      .select({
        createdAt: schema.convMessages.createdAt,
        metadata: schema.convMessages.metadata,
      })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.id, messageId))
      .limit(1);
    if (!message) return null;
    const turn = message.metadata.voiceTurnIndex;
    return {
      orderAt: message.createdAt,
      orderSeq: typeof turn === 'number' && Number.isInteger(turn) && turn >= 0 ? turn : -1,
    };
  }
}
