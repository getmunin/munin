import { Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';

export const PRODUCT_EVENT_TYPE = 'analytics.product_event.recorded';
export const JOURNEY_RUNTIME_ACTOR_ID = 'journey-runtime';

const RELEVANT_PREFIXES: readonly string[] = [
  'analytics.product_event.',
  'conversation.',
  'crm.contact.',
  'crm.deal.',
  'crm.activity.',
  'outreach.proposal.',
  'outreach.outcome.',
  'journey.exited',
];

export function isJourneyRelevantEvent(type: string): boolean {
  return RELEVANT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export function journeyEventKey(type: string, payload: Record<string, unknown>): string {
  if (type === PRODUCT_EVENT_TYPE && typeof payload.name === 'string') return payload.name;
  return type;
}

@Injectable()
export class JourneyEventSink implements EventSink {
  async onEvent(event: EmittedEvent): Promise<void> {
    if (!isJourneyRelevantEvent(event.type)) return;
    const ctx = getCurrentContext();
    await ctx.db.insert(schema.journeyEventInbox).values({
      orgId: event.orgId,
      eventId: event.eventId,
      type: event.type,
      actorId: event.actorId ?? null,
      hopCount: event.hopCount ?? 0,
      payload: event.payload,
    });
  }
}
