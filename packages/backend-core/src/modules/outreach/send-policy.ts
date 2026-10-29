import { schema } from '@getmunin/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import type { MESSAGE_CLASSES, Weekday } from '@getmunin/types';
import { nextSendableTime } from '../../common/send-window.ts';
import { readSendRules, type SendRules } from './send-rules.ts';

export type MessageClass = (typeof MESSAGE_CLASSES)[number];

export interface SendPolicy {
  channel?: 'email' | 'sms' | 'voice' | 'chat';
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

interface ContactFacts {
  id: string;
  email: string | null;
  phone: string | null;
  endUserId: string | null;
  doNotContact: boolean;
  unsubscribedAt: Date | null;
  consentLawfulBasis: string | null;
  customFields: Record<string, unknown> | null;
}

export async function checkSendPolicy(input: {
  contactId: string;
  policy: SendPolicy;
  now?: Date;
}): Promise<SendDecision> {
  const decisions = await checkSendPolicyBatch({ contactIds: [input.contactId], policy: input.policy, now: input.now });
  return decisions.get(input.contactId)!;
}

export async function checkSendPolicyBatch(input: {
  contactIds: string[];
  policy: SendPolicy;
  now?: Date;
}): Promise<Map<string, SendDecision>> {
  const ctx = getCurrentContext();
  const orgId = ctx.actor!.orgId;
  const now = input.now ?? new Date();
  const { policy } = input;
  const ids = [...new Set(input.contactIds)];
  const decisions = new Map<string, SendDecision>();
  if (ids.length === 0) return decisions;
  const rules = await readSendRules(ctx.db, orgId);
  const marketing = policy.class === 'marketing';
  const sms = policy.channel === 'sms' || policy.channel === 'voice';
  const chat = policy.channel === 'chat';

  const c = schema.crmContacts;
  const contacts: ContactFacts[] = await ctx.db
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
    .where(and(eq(c.orgId, orgId), inArray(c.id, ids)));
  const byId = new Map(contacts.map((row) => [row.id, row]));

  const chatIdentities = chat ? await signedInEndUsers(contacts) : new Set<string>();
  const undeliverable = !sms && !chat ? await undeliverableEmails(orgId, contacts) : new Set<string>();

  const eligible: ContactFacts[] = [];
  for (const id of ids) {
    const contact = byId.get(id);
    const reason = !contact ? 'contact_missing' : floorBlock(contact, { marketing, sms, chat, chatIdentities, undeliverable });
    if (reason) decisions.set(id, { decision: 'skip', reason });
    else eligible.push(contact!);
  }
  if (eligible.length === 0) return decisions;

  const cap = minDefined(marketing ? rules.weeklyCap : null, marketing ? policy.frequencyCapPerWeek : undefined);
  const cooldownHours = marketing
    ? Math.max(rules.cooldownHoursAfterConversation, policy.cooldownHoursAfterConversation)
    : 0;
  const eligibleIds = eligible.map((e) => e.id);
  const capTimes = cap ? await marketingSendTimes(eligibleIds, new Date(now.getTime() - WEEK_MS)) : new Map<string, number[]>();
  const assigned = marketing ? await contactsWithAssignedConversation(eligible) : new Set<string>();
  const lastInbound =
    marketing && cooldownHours > 0
      ? await latestInboundAt(eligible, new Date(now.getTime() - cooldownHours * 3_600_000))
      : new Map<string, Date>();

  const validDays = intersectDays(marketing ? rules.validDays : null, policy.validDays ?? null);
  const quietWindows = chat
    ? []
    : [marketing ? rules.quietHours : null, policy.quietHours ?? null].filter((w): w is string => !!w);

  for (const contact of eligible) {
    if (cap) {
      const times = (capTimes.get(contact.id) ?? []).sort((a, b) => a - b);
      if (times.length >= cap) {
        decisions.set(contact.id, { decision: 'defer', until: new Date(times[times.length - cap]! + WEEK_MS), reason: 'frequency_cap' });
        continue;
      }
    }
    if (assigned.has(contact.id)) {
      decisions.set(contact.id, { decision: 'defer', until: new Date(now.getTime() + ASSIGNED_RECHECK_MS), reason: 'conversation_assigned' });
      continue;
    }
    const inbound = lastInbound.get(contact.id);
    if (inbound) {
      decisions.set(contact.id, {
        decision: 'defer',
        until: new Date(inbound.getTime() + cooldownHours * 3_600_000),
        reason: 'recent_conversation',
      });
      continue;
    }
    if (validDays && validDays.length === 0) {
      decisions.set(contact.id, { decision: 'skip', reason: 'no_valid_days' });
      continue;
    }
    const timezone = resolveTimezone(contact.customFields?.timezone, policy.timezone, rules);
    const window = nextSendableTime(now, timezone, { validDays, quietWindows });
    if (!window) {
      decisions.set(contact.id, { decision: 'skip', reason: 'no_send_window' });
      continue;
    }
    decisions.set(
      contact.id,
      window.getTime() > now.getTime() ? { decision: 'defer', until: window, reason: 'quiet_hours' } : { decision: 'send' },
    );
  }
  return decisions;
}

function floorBlock(
  contact: ContactFacts,
  opts: { marketing: boolean; sms: boolean; chat: boolean; chatIdentities: Set<string>; undeliverable: Set<string> },
): string | null {
  if (contact.doNotContact) return 'do_not_contact';
  if (opts.chat) {
    if (!contact.endUserId || !opts.chatIdentities.has(contact.endUserId)) return 'no_chat_identity';
  } else if (opts.sms ? !contact.phone : !contact.email) {
    return opts.sms ? 'no_phone' : 'no_email';
  }
  if (opts.marketing) {
    if (contact.unsubscribedAt) return 'unsubscribed';
    if (!contact.consentLawfulBasis) return 'no_lawful_basis';
  }
  if (contact.email && opts.undeliverable.has(contact.email.toLowerCase())) return 'undeliverable';
  return null;
}

async function signedInEndUsers(contacts: ContactFacts[]): Promise<Set<string>> {
  const endUserIds = contacts.map((row) => row.endUserId).filter((id): id is string => !!id);
  if (endUserIds.length === 0) return new Set();
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.endUsers.id, externalId: schema.endUsers.externalId })
    .from(schema.endUsers)
    .where(inArray(schema.endUsers.id, endUserIds));
  return new Set(rows.filter((r) => !!r.externalId && !r.externalId.startsWith('anon:')).map((r) => r.id));
}

async function undeliverableEmails(orgId: string, contacts: ContactFacts[]): Promise<Set<string>> {
  const emails = [...new Set(contacts.map((row) => row.email?.toLowerCase()).filter((e): e is string => !!e))];
  if (emails.length === 0) return new Set();
  const ctx = getCurrentContext();
  const d = schema.crmAddressDeliverability;
  const rows = await ctx.db
    .select({ address: sql<string>`lower(${d.address})` })
    .from(d)
    .where(and(eq(d.orgId, orgId), eq(d.state, 'undeliverable'), sql`lower(${d.address}) IN (${list(emails)})`));
  return new Set(rows.map((r) => r.address));
}

async function marketingSendTimes(contactIds: string[], since: Date): Promise<Map<string, number[]>> {
  const ctx = getCurrentContext();
  const rows = await ctx.db.execute<{ contact_id: string; sent_at: Date | string }>(sql`
    SELECT contact_id, sent_at FROM outreach_proposals
     WHERE contact_id IN (${list(contactIds)}) AND status = 'sent' AND sent_at >= ${since.toISOString()}::timestamptz
       AND (kind IN ('initial', 'followup')
            OR (kind = 'journey' AND coalesce(evidence -> 'journeyMessage' -> 'policy' ->> 'class', 'marketing') = 'marketing'))
    UNION ALL
    SELECT contact_id, sent_at FROM outreach_broadcast_recipients
     WHERE contact_id IN (${list(contactIds)}) AND status = 'sent' AND sent_at >= ${since.toISOString()}::timestamptz
  `);
  const times = new Map<string, number[]>();
  for (const row of rows) {
    const bucket = times.get(row.contact_id) ?? [];
    bucket.push(new Date(row.sent_at).getTime());
    times.set(row.contact_id, bucket);
  }
  return times;
}

function threadsOf(contacts: ContactFacts[]): SQL {
  const ids = contacts.map((row) => row.id);
  const pairs = contacts.filter((row) => row.endUserId);
  const byEndUser = pairs.length
    ? sql`SELECT c.id AS contact_id, cv.id AS conversation_id FROM crm_contacts c
            JOIN conv_conversations cv ON cv.end_user_id = c.end_user_id
           WHERE c.id IN (${list(pairs.map((p) => p.id))})
          UNION `
    : sql``;
  return sql`(${byEndUser}SELECT p.contact_id, p.conversation_id FROM outreach_proposals p
               WHERE p.contact_id IN (${list(ids)}) AND p.conversation_id IS NOT NULL)`;
}

async function contactsWithAssignedConversation(contacts: ContactFacts[]): Promise<Set<string>> {
  const ctx = getCurrentContext();
  const rows = await ctx.db.execute<{ contact_id: string }>(sql`
    SELECT DISTINCT t.contact_id FROM ${threadsOf(contacts)} t
      JOIN conv_conversations cv ON cv.id = t.conversation_id
     WHERE cv.status = 'open' AND cv.assignee_user_id IS NOT NULL
  `);
  return new Set([...rows].map((r) => r.contact_id));
}

async function latestInboundAt(contacts: ContactFacts[], since: Date): Promise<Map<string, Date>> {
  const ctx = getCurrentContext();
  const rows = await ctx.db.execute<{ contact_id: string; at: Date | string }>(sql`
    SELECT t.contact_id, max(m.created_at) AS at FROM ${threadsOf(contacts)} t
      JOIN conv_messages m ON m.conversation_id = t.conversation_id
     WHERE m.author_type = 'end_user' AND m.created_at >= ${since.toISOString()}::timestamptz
     GROUP BY t.contact_id
  `);
  return new Map([...rows].map((r) => [r.contact_id, new Date(r.at)]));
}

function list(values: string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
}

function minDefined(...values: (number | null | undefined)[]): number | null {
  const defined = values.filter((v): v is number => typeof v === 'number');
  return defined.length ? Math.min(...defined) : null;
}

function intersectDays(a: Weekday[] | null, b: Weekday[] | null): Weekday[] | null {
  if (!a) return b;
  if (!b) return a;
  return a.filter((day) => b.includes(day));
}

function resolveTimezone(contactTz: unknown, policyTz: string | undefined, rules: SendRules): string {
  for (const tz of [contactTz, policyTz, rules.timezone]) {
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
