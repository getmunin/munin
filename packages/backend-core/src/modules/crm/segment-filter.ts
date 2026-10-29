import { schema } from '@getmunin/db';
import { eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { CrmInvalidError } from './crm.errors.ts';

export interface SegmentMatchDefinition {
  tagsAny?: string[];
  tagsAll?: string[];
  companyId?: string;
  searchQuery?: string;
  contactedSince?: string;
  events?: SegmentEventFilter[];
}

export interface SegmentEventFilter {
  name: string;
  occurred: boolean;
  withinDays?: number;
  minCount?: number;
}

export const SEGMENT_EVENT_FILTER_MAX = 5;

export const OUTREACH_ELIGIBILITY_FLOOR: readonly SQL[] = [
  eq(schema.crmContacts.doNotContact, false),
  sql`${schema.crmContacts.unsubscribedAt} IS NULL`,
  sql`${schema.crmContacts.consentLawfulBasis} IS NOT NULL`,
];

export function segmentMatchFilters(f: SegmentMatchDefinition): SQL[] {
  const filters: SQL[] = [];
  if (f.companyId) filters.push(eq(schema.crmContacts.companyId, f.companyId));
  if (f.tagsAny && f.tagsAny.length > 0) {
    const anyChecks = f.tagsAny.map(
      (t) => sql`${schema.crmContacts.tags} @> ${JSON.stringify([t])}::jsonb`,
    );
    filters.push(or(...anyChecks)!);
  }
  if (f.tagsAll && f.tagsAll.length > 0) {
    filters.push(sql`${schema.crmContacts.tags} @> ${JSON.stringify(f.tagsAll)}::jsonb`);
  }
  if (f.contactedSince) {
    const since = new Date(f.contactedSince);
    if (Number.isNaN(since.valueOf())) {
      throw new CrmInvalidError('filter.contactedSince must be ISO timestamp');
    }
    filters.push(
      sql`(${schema.crmContacts.lastContactedAt} IS NULL OR ${schema.crmContacts.lastContactedAt} < ${since})`,
    );
  }
  if (f.searchQuery) {
    const q = `%${f.searchQuery}%`;
    filters.push(
      or(
        ilike(schema.crmContacts.name, q),
        ilike(schema.crmContacts.email, q),
        ilike(schema.crmContacts.title, q),
      )!,
    );
  }
  for (const e of f.events ?? []) filters.push(productEventFilter(e));
  return filters;
}

function productEventFilter(e: SegmentEventFilter): SQL {
  const pe = schema.analyticsProductEvents;
  const c = schema.crmContacts;
  const conditions: SQL[] = [
    sql`${pe.orgId} = ${c.orgId}`,
    sql`${pe.name} = ${e.name}`,
    sql`(${pe.contactId} = ${c.id} OR (${c.endUserId} IS NOT NULL AND ${pe.endUserId} = ${c.endUserId}))`,
  ];
  if (e.withinDays !== undefined) {
    conditions.push(sql`${pe.occurredAt} >= now() - make_interval(days => ${e.withinDays})`);
  }
  const minCount = Math.max(1, e.minCount ?? 1);
  const matched =
    minCount === 1
      ? sql`EXISTS (SELECT 1 FROM ${pe} WHERE ${sql.join(conditions, sql` AND `)})`
      : sql`(SELECT count(*) FROM ${pe} WHERE ${sql.join(conditions, sql` AND `)}) >= ${minCount}`;
  return e.occurred ? matched : sql`NOT ${matched}`;
}
