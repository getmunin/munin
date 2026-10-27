import { schema } from '@getmunin/db';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import type { MESSAGE_CLASSES, Weekday } from '@getmunin/types';
import { nextValidTime } from '../journeys/journey-time.ts';

export type MessageClass = (typeof MESSAGE_CLASSES)[number];

export interface SendPolicy {
  channel?: 'email' | 'sms' | 'voice';
  class: MessageClass;
  timezone?: string;
  quietHours?: string;
  validDays?: Weekday[];
  frequencyCapPerWeek?: number;
  cooldownHoursAfterConversation: number;
}

export type SendDecision =
  | { decision: 'send' }
  | { decision: 'defer'; until: Date; reason: string }
  | { decision: 'skip'; reason: string };

const WEEK_MS = 7 * 86_400_000;
const ASSIGNED_RECHECK_MS = 60 * 60_000;

export async function checkSendPolicy(input: {
  contactId: string;
  policy: SendPolicy;
  now?: Date;
}): Promise<SendDecision> {
  const ctx = getCurrentContext();
  const orgId = ctx.actor!.orgId;
  const now = input.now ?? new Date();
  const { policy } = input;
  const c = schema.crmContacts;
  const [contact] = await ctx.db
    .select({
      id: c.id,
      email: c.email,
      phone: c.phone,
      endUserId: c.endUserId,
      doNotContact: c.doNotContact,
      unsubscribedAt: c.unsubscribedAt,
      consentLawfulBasis: c.consentLawfulBasis,
      customFields: c.customFields,
    })
    .from(c)
    .where(and(eq(c.orgId, orgId), eq(c.id, input.contactId)))
    .limit(1);
  if (!contact) return { decision: 'skip', reason: 'contact_missing' };
  if (contact.doNotContact) return { decision: 'skip', reason: 'do_not_contact' };
  const sms = policy.channel === 'sms' || policy.channel === 'voice';
  if (sms ? !contact.phone : !contact.email) return { decision: 'skip', reason: sms ? 'no_phone' : 'no_email' };
  if (policy.class === 'marketing') {
    if (contact.unsubscribedAt) return { decision: 'skip', reason: 'unsubscribed' };
    if (!contact.consentLawfulBasis) return { decision: 'skip', reason: 'no_lawful_basis' };
  }

  if (contact.email && !sms) {
    const [deliverability] = await ctx.db
      .select({ state: schema.crmAddressDeliverability.state })
      .from(schema.crmAddressDeliverability)
      .where(
        and(
          eq(schema.crmAddressDeliverability.orgId, orgId),
          sql`lower(${schema.crmAddressDeliverability.address}) = ${contact.email.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (deliverability?.state === 'undeliverable') return { decision: 'skip', reason: 'undeliverable' };
  }

  if (policy.class === 'marketing') {
    const cap = await frequencyCapUntil(contact.id, policy.frequencyCapPerWeek, now);
    if (cap) return { decision: 'defer', until: cap, reason: 'frequency_cap' };
    const talking = await talkingUntil(contact.id, contact.endUserId, policy.cooldownHoursAfterConversation, now);
    if (talking) return { decision: 'defer', until: talking.until, reason: talking.reason };
  }

  const timezone = resolveTimezone(contact.customFields?.timezone, policy.timezone);
  const window = nextValidTime(now, timezone, policy.validDays, invertQuietHours(policy.quietHours));
  if (window.getTime() > now.getTime()) return { decision: 'defer', until: window, reason: 'quiet_hours' };
  return { decision: 'send' };
}

async function frequencyCapUntil(contactId: string, cap: number | undefined, now: Date): Promise<Date | null> {
  if (!cap) return null;
  const ctx = getCurrentContext();
  const since = new Date(now.getTime() - WEEK_MS);
  const p = schema.outreachProposals;
  const sent = await ctx.db
    .select({ sentAt: p.sentAt })
    .from(p)
    .where(
      and(
        eq(p.contactId, contactId),
        eq(p.status, 'sent'),
        inArray(p.kind, ['initial', 'followup', 'journey']),
        gte(p.sentAt, since),
      ),
    );
  const r = schema.outreachBroadcastRecipients;
  const broadcasts = await ctx.db
    .select({ sentAt: r.sentAt })
    .from(r)
    .where(and(eq(r.contactId, contactId), eq(r.status, 'sent'), gte(r.sentAt, since)));
  const times = [...sent, ...broadcasts]
    .map((row) => row.sentAt?.getTime())
    .filter((t): t is number => typeof t === 'number')
    .sort((a, b) => a - b);
  if (times.length < cap) return null;
  return new Date(times[times.length - cap]! + WEEK_MS);
}

async function talkingUntil(
  contactId: string,
  endUserId: string | null,
  cooldownHours: number,
  now: Date,
): Promise<{ until: Date; reason: string } | null> {
  const ctx = getCurrentContext();
  const cv = schema.convConversations;
  const theirs = endUserId
    ? sql`(${cv.endUserId} = ${endUserId} OR ${cv.id} IN (SELECT conversation_id FROM outreach_proposals WHERE contact_id = ${contactId} AND conversation_id IS NOT NULL))`
    : sql`${cv.id} IN (SELECT conversation_id FROM outreach_proposals WHERE contact_id = ${contactId} AND conversation_id IS NOT NULL)`;
  const [assigned] = await ctx.db
    .select({ id: cv.id })
    .from(cv)
    .where(and(theirs, eq(cv.status, 'open'), isNotNull(cv.assigneeUserId)))
    .limit(1);
  if (assigned) return { until: new Date(now.getTime() + ASSIGNED_RECHECK_MS), reason: 'conversation_assigned' };
  if (cooldownHours <= 0) return null;
  const m = schema.convMessages;
  const since = new Date(now.getTime() - cooldownHours * 3_600_000);
  const [latest] = await ctx.db
    .select({ at: sql<Date>`max(${m.createdAt})` })
    .from(m)
    .innerJoin(cv, eq(cv.id, m.conversationId))
    .where(and(theirs, eq(m.authorType, 'end_user'), gte(m.createdAt, since)));
  const at = latest?.at ? new Date(latest.at) : null;
  if (!at) return null;
  return { until: new Date(at.getTime() + cooldownHours * 3_600_000), reason: 'recent_conversation' };
}

function resolveTimezone(contactTz: unknown, fallback: string | undefined): string {
  for (const tz of [contactTz, fallback]) {
    if (typeof tz !== 'string') continue;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      continue;
    }
  }
  return 'UTC';
}

function invertQuietHours(quiet: string | undefined): string | undefined {
  if (!quiet) return undefined;
  const [from, to] = quiet.split('-');
  return `${to}-${from}`;
}
