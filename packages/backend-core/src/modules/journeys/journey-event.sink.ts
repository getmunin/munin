import { Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
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

const RUNNING_CACHE_MS = 60_000;

export function isJourneyRelevantEvent(type: string): boolean {
  return RELEVANT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export function journeyEventKey(type: string, payload: Record<string, unknown>): string {
  if (type === PRODUCT_EVENT_TYPE && typeof payload.name === 'string') return payload.name;
  return type;
}

@Injectable()
export class JourneyEventSink implements EventSink {
  private readonly running = new Map<string, number>();

  async onEvent(event: EmittedEvent): Promise<void> {
    if (!isJourneyRelevantEvent(event.type)) return;
    const ctx = getCurrentContext();
    if (!(await this.hasRunningJourneys(event.orgId))) return;
    await ctx.db.insert(schema.journeyEventInbox).values({
      orgId: event.orgId,
      eventId: event.eventId,
      type: event.type,
      actorId: event.actorId ?? null,
      hopCount: event.hopCount ?? 0,
      payload: event.payload,
    });
  }

  private async hasRunningJourneys(orgId: string): Promise<boolean> {
    const ctx = getCurrentContext();
    if (ctx.actor?.orgId !== orgId) return true;
    if ((this.running.get(orgId) ?? 0) > Date.now()) return true;
    const result = await ctx.db.execute(sql`SELECT journeys_org_running() AS running`);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    if ((rows[0] as { running?: boolean } | undefined)?.running !== true) return false;
    this.running.set(orgId, Date.now() + RUNNING_CACHE_MS);
    return true;
  }
}
