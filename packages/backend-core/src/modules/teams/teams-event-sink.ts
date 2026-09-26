import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import { TEAMS_MIRRORED_EVENT_TYPES } from './teams.constants.ts';

@Injectable()
export class TeamsEventSink implements EventSink {
  async onEvent(event: EmittedEvent): Promise<void> {
    if (!TEAMS_MIRRORED_EVENT_TYPES.includes(event.type)) return;
    if (event.payload.autoReply === true) return;
    const conversationId =
      typeof event.payload.conversationId === 'string' ? event.payload.conversationId : null;
    if (!conversationId) return;
    const ctx = getCurrentContext();
    const [integration] = await ctx.db
      .select({ id: schema.teamsIntegrations.id })
      .from(schema.teamsIntegrations)
      .where(
        and(
          eq(schema.teamsIntegrations.orgId, event.orgId),
          eq(schema.teamsIntegrations.active, true),
          isNotNull(schema.teamsIntegrations.encryptedAppSecret),
        ),
      )
      .limit(1);
    if (!integration) return;

    const order = await this.messageOrder(event);
    await ctx.db.insert(schema.teamsDeliveries).values({
      orgId: event.orgId,
      integrationId: integration.id,
      eventId: event.eventId,
      eventType: event.type,
      conversationId,
      nextAttemptAt: new Date(),
      ...(order ? { orderAt: order.orderAt, orderSeq: order.orderSeq } : {}),
    });
  }

  private async messageOrder(
    event: EmittedEvent,
  ): Promise<{ orderAt: Date; orderSeq: number } | null> {
    const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : null;
    if (!messageId) return null;
    const [message] = await getCurrentContext()
      .db.select({
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
