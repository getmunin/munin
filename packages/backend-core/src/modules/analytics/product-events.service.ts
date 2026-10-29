import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, count, desc, eq, gte, max, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { IdentityService } from '../identity/identity.service.ts';
import { CONSENT_LAWFUL_BASES, CrmService, type ConsentLawfulBasis } from '../crm/crm.service.ts';
import { normalizeIdentityEmail } from './visitor-identity.ts';
import { KNOWN_EVENT_TYPES } from '@getmunin/types';

export const PRODUCT_EVENT_NAME_PATTERN = /^[a-z0-9_.-]{1,64}$/;
export const PRODUCT_EVENT_MAX_BATCH = 100;
export const PRODUCT_EVENT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const RESERVED_EVENT_PREFIXES: readonly string[] = [
  ...new Set(KNOWN_EVENT_TYPES.map((type) => `${type.slice(0, type.indexOf('.'))}.`)),
];
export const PRODUCT_EVENT_MAX_PROPERTIES_BYTES = 8_192;
export const PRODUCT_EVENT_CONSENT_SCOPE = 'crm:write';

export interface ProductEventIdentity {
  contactId?: string;
  externalId?: string;
  email?: string;
  phone?: string;
  verified?: boolean;
}

export interface ProductEventConsent {
  lawfulBasis: ConsentLawfulBasis;
  source: string;
  givenAt?: string;
  evidence?: Record<string, unknown>;
}

export interface ProductEventInput {
  id: string;
  name: string;
  occurredAt?: string;
  identity: ProductEventIdentity;
  properties?: Record<string, unknown>;
  consent?: ProductEventConsent;
}

export interface ProductEventResult {
  id: string;
  status: 'recorded' | 'duplicate';
  eventId: string | null;
  contactId: string | null;
  endUserId: string | null;
  consent?: 'recorded' | 'kept';
}

export interface ProductEventNameDto {
  name: string;
  count: number;
  lastOccurredAt: string;
}

@Injectable()
export class ProductEventsService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(CrmService) private readonly crm: Pick<CrmService, 'createContact' | 'setContactConsent'>,
  ) {}

  async record(events: readonly ProductEventInput[]): Promise<ProductEventResult[]> {
    if (events.length > PRODUCT_EVENT_MAX_BATCH) {
      throw new BadRequestException(
        `analytics_invalid: at most ${PRODUCT_EVENT_MAX_BATCH} events per request`,
      );
    }
    if (events.some((e) => e.consent)) assertMayRecordConsent();
    const results: ProductEventResult[] = [];
    for (const event of events) results.push(await this.recordOne(event));
    return results;
  }

  async listEventNames(days = 30): Promise<ProductEventNameDto[]> {
    const ctx = getCurrentContext();
    const t = schema.analyticsProductEvents;
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await ctx.db
      .select({ name: t.name, count: count(), lastOccurredAt: max(t.occurredAt) })
      .from(t)
      .where(and(eq(t.orgId, ctx.actor!.orgId), gte(t.occurredAt, since)))
      .groupBy(t.name)
      .orderBy(desc(count()))
      .limit(200);
    return rows.map((r) => ({
      name: r.name,
      count: Number(r.count),
      lastOccurredAt: (r.lastOccurredAt ?? since).toISOString(),
    }));
  }

  private async recordOne(event: ProductEventInput): Promise<ProductEventResult> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const name = event.name.trim();
    if (RESERVED_EVENT_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      throw new BadRequestException(
        `analytics_invalid: event name "${name}" uses a prefix reserved for Munin's own events (${RESERVED_EVENT_PREFIXES.join(', ')}); name it after what happened in your product`,
      );
    }
    if (!PRODUCT_EVENT_NAME_PATTERN.test(name)) {
      throw new BadRequestException(
        `analytics_invalid: event name "${event.name}" must match ${PRODUCT_EVENT_NAME_PATTERN.source}`,
      );
    }
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.valueOf())) {
      throw new BadRequestException(`analytics_invalid: occurredAt must be an ISO timestamp`);
    }
    if (occurredAt.getTime() > Date.now() + PRODUCT_EVENT_MAX_FUTURE_SKEW_MS) {
      throw new BadRequestException(
        `analytics_invalid: occurredAt ${occurredAt.toISOString()} is in the future; send the time the event happened`,
      );
    }
    const properties = event.properties ?? {};
    if (Buffer.byteLength(JSON.stringify(properties)) > PRODUCT_EVENT_MAX_PROPERTIES_BYTES) {
      throw new BadRequestException(
        `analytics_invalid: properties must be at most ${PRODUCT_EVENT_MAX_PROPERTIES_BYTES} bytes`,
      );
    }
    const consent = event.consent ? validConsent(event, occurredAt) : null;

    const t = schema.analyticsProductEvents;
    const [existing] = await ctx.db
      .select({ id: t.id, contactId: t.contactId, endUserId: t.endUserId })
      .from(t)
      .where(and(eq(t.orgId, orgId), eq(t.externalEventId, event.id)))
      .limit(1);
    if (existing) {
      return {
        id: event.id,
        status: 'duplicate',
        eventId: existing.id,
        contactId: existing.contactId,
        endUserId: existing.endUserId,
      };
    }

    const verified = event.identity.verified !== false;
    if (consent && !verified) {
      throw new BadRequestException(
        `analytics_invalid: event ${event.id} records consent for an identity that is not verified`,
      );
    }
    const subject = verified ? await this.resolveSubject(event.identity) : { contactId: null, endUserId: null };
    const endUserId = subject.endUserId;
    let contactId = subject.contactId;
    let consentResult: 'recorded' | 'kept' | undefined;
    if (consent) {
      const applied = await this.applyConsent(event, consent, contactId, endUserId);
      contactId = applied.contactId;
      consentResult = applied.result;
    }
    const [row] = await ctx.db
      .insert(t)
      .values({
        orgId,
        externalEventId: event.id,
        name,
        endUserId,
        contactId,
        properties,
        occurredAt,
      })
      .onConflictDoNothing({ target: [t.orgId, t.externalEventId] })
      .returning({ id: t.id });
    if (!row) {
      return { id: event.id, status: 'duplicate', eventId: null, contactId, endUserId };
    }

    await this.webhooks.emit({
      type: 'analytics.product_event.recorded',
      payload: {
        eventId: row.id,
        externalEventId: event.id,
        name,
        contactId,
        endUserId,
        occurredAt: occurredAt.toISOString(),
        properties,
        ...(verified ? {} : { identityVerified: false }),
      },
    });
    return {
      id: event.id,
      status: 'recorded',
      eventId: row.id,
      contactId,
      endUserId,
      ...(consentResult ? { consent: consentResult } : {}),
    };
  }

  private async applyConsent(
    event: ProductEventInput,
    consent: ValidConsent,
    contactId: string | null,
    endUserId: string | null,
  ): Promise<{ contactId: string; result: 'recorded' | 'kept' }> {
    const ctx = getCurrentContext();
    let id = contactId;
    if (!id) {
      const email = normalizeIdentityEmail(event.identity.email);
      if (!email) {
        throw new BadRequestException(
          `analytics_invalid: event ${event.id} records consent, but its identity matches no contact and has no email to create one with`,
        );
      }
      const created = await this.crm.createContact({
        email,
        ...(event.identity.phone?.trim() ? { phone: event.identity.phone.trim() } : {}),
        ...(endUserId ? { endUserId } : {}),
      });
      id = created.id;
    }
    const [current] = await ctx.db
      .select({ basis: schema.crmContacts.consentLawfulBasis })
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.id, id))
      .limit(1);
    if (current?.basis) return { contactId: id, result: 'kept' };
    await this.crm.setContactConsent({
      contactId: id,
      lawfulBasis: consent.lawfulBasis,
      source: consent.source,
      givenAt: consent.givenAt,
      evidence: { ...consent.evidence, productEvent: { id: event.id, name: event.name.trim() } },
    });
    return { contactId: id, result: 'recorded' };
  }

  private async resolveSubject(
    input: ProductEventIdentity,
  ): Promise<{ contactId: string | null; endUserId: string | null }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const contacts = schema.crmContacts;

    if (input.contactId) {
      const [contact] = await ctx.db
        .select({ id: contacts.id, endUserId: contacts.endUserId })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.id, input.contactId)))
        .limit(1);
      if (!contact) {
        throw new BadRequestException(
          `analytics_invalid: contact ${input.contactId} not found in this organization`,
        );
      }
      return { contactId: contact.id, endUserId: contact.endUserId };
    }

    const email = normalizeIdentityEmail(input.email);
    const phone = input.phone?.trim() || undefined;
    const externalId = input.externalId?.trim() || undefined;
    if (!email && !phone && !externalId) {
      throw new BadRequestException(
        'analytics_invalid: identity needs one of contactId, externalId, email or phone',
      );
    }

    const resolved = await this.identity.resolve({ externalId, email: email ?? undefined, phone });
    let endUserId = resolved.endUserId;
    if (!endUserId) {
      const created = await this.identity.findOrCreate({
        externalId,
        email: email ?? undefined,
        phone,
      });
      endUserId = created.id;
    }

    let contactId = resolved.crmContactId;
    if (!contactId) {
      const [byEndUser] = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.endUserId, endUserId)))
        .limit(1);
      contactId = byEndUser?.id ?? null;
    }
    if (!contactId && email) {
      const [byEmail] = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), sql`lower(${contacts.email}) = ${email}`))
        .limit(1);
      contactId = byEmail?.id ?? null;
    }
    return { contactId, endUserId };
  }
}

interface ValidConsent {
  lawfulBasis: ConsentLawfulBasis;
  source: string;
  givenAt: string;
  evidence: Record<string, unknown>;
}

function assertMayRecordConsent(): void {
  const actor = getCurrentContext().actor!;
  if (actor.type === 'user' || actor.type === 'system') return;
  if (actor.hasScope(PRODUCT_EVENT_CONSENT_SCOPE)) return;
  throw new ForbiddenException(
    `analytics_forbidden: recording consent with an event needs a key with the ${PRODUCT_EVENT_CONSENT_SCOPE} scope as well as analytics:write`,
  );
}

function validConsent(event: ProductEventInput, occurredAt: Date): ValidConsent {
  const consent = event.consent!;
  if (!CONSENT_LAWFUL_BASES.includes(consent.lawfulBasis)) {
    throw new BadRequestException(
      `analytics_invalid: consent.lawfulBasis must be one of ${CONSENT_LAWFUL_BASES.join(', ')}`,
    );
  }
  const source = consent.source.trim();
  if (!source) throw new BadRequestException('analytics_invalid: consent.source must not be empty');
  const givenAt = consent.givenAt ? new Date(consent.givenAt) : occurredAt;
  if (Number.isNaN(givenAt.valueOf())) {
    throw new BadRequestException('analytics_invalid: consent.givenAt must be an ISO timestamp');
  }
  if (givenAt.getTime() > Date.now() + PRODUCT_EVENT_MAX_FUTURE_SKEW_MS) {
    throw new BadRequestException(
      `analytics_invalid: consent.givenAt ${givenAt.toISOString()} is in the future; send the time the person agreed`,
    );
  }
  const evidence = consent.evidence ?? {};
  if (Buffer.byteLength(JSON.stringify(evidence)) > PRODUCT_EVENT_MAX_PROPERTIES_BYTES) {
    throw new BadRequestException(
      `analytics_invalid: consent.evidence must be at most ${PRODUCT_EVENT_MAX_PROPERTIES_BYTES} bytes`,
    );
  }
  return { lawfulBasis: consent.lawfulBasis, source, givenAt: givenAt.toISOString(), evidence };
}
