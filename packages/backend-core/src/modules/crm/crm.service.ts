import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';

export class CrmInvalidError extends Error {
  readonly code = 'crm_invalid';
  constructor(message: string) {
    super(`crm_invalid: ${message}`);
  }
}

export const ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting', 'task'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const RELATIONSHIP_TYPES = ['contact', 'company', 'deal'] as const;
export type RelationshipEntityType = (typeof RELATIONSHIP_TYPES)[number];

export interface ContactDto {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  address: string | null;
  companyId: string | null;
  endUserId: string | null;
  ownerUserId: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
  aiSummary: string | null;
  aiNextAction: string | null;
  engagementScore: number;
  doNotContact: boolean;
  unsubscribedAt: string | null;
  lastContactedAt: string | null;
  consentLawfulBasis: ConsentLawfulBasis | null;
  consentGivenAt: string | null;
  consentSource: string | null;
  consentEvidence: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const CONSENT_LAWFUL_BASES = ['consent', 'legitimate_interest', 'contract'] as const;
export type ConsentLawfulBasis = (typeof CONSENT_LAWFUL_BASES)[number];

export interface SegmentFilter {
  tagsAny?: string[];
  tagsAll?: string[];
  companyId?: string;
  searchQuery?: string;
  contactedSince?: string;
}

export interface SegmentDto {
  id: string;
  name: string;
  description: string | null;
  filterDefinition: SegmentFilter;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  domain: string | null;
  ownerUserId: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
  aiSummary: string | null;
  aiNextAction: string | null;
  engagementScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineDto {
  id: string;
  name: string;
  slug: string;
  position: number;
  stages: StageDto[];
}

export interface StageDto {
  id: string;
  name: string;
  position: number;
  winLoss: 'open' | 'won' | 'lost';
}

export interface DealDto {
  id: string;
  name: string;
  pipelineId: string;
  stageId: string;
  amountCents: number | null;
  currency: string | null;
  primaryContactId: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  expectedCloseAt: string | null;
  closedAt: string | null;
  aiSummary: string | null;
  aiNextAction: string | null;
  engagementScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityDto {
  id: string;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  endUserId: string | null;
  actorType: string;
  actorId: string;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export const MERGE_CONFIDENCES = ['high', 'medium'] as const;
export type MergeConfidence = (typeof MERGE_CONFIDENCES)[number];

export const MERGE_STATUSES = ['pending', 'applied', 'dismissed'] as const;
export type MergeStatus = (typeof MERGE_STATUSES)[number];

export interface MergeProposalContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  endUserId: string | null;
}

export interface MergeProposalDto {
  id: string;
  contactA: MergeProposalContactSummary;
  contactB: MergeProposalContactSummary;
  confidence: MergeConfidence;
  evidence: Record<string, unknown>;
  recommendedKeeperId: string;
  recommendedPatch: Record<string, unknown>;
  status: MergeStatus;
  dismissReason: string | null;
  proposedByActorType: string;
  proposedByActorId: string;
  decidedByActorType: string | null;
  decidedByActorId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CrmService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  // ─── Contacts ───────────────────────────────────────────────────────────

  async listContacts(input: {
    companyId?: string;
    tag?: string;
    limit?: number;
  }): Promise<ContactDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters: SQL[] = [];
    if (input.companyId) filters.push(eq(schema.crmContacts.companyId, input.companyId));
    if (input.tag) {
      filters.push(sql`${schema.crmContacts.tags} @> ${JSON.stringify([input.tag])}::jsonb`);
    }
    const rows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(schema.crmContacts.updatedAt))
      .limit(limit);
    return rows.map(toContactDto);
  }

  async getContact(id: string): Promise<ContactDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`crm_not_found: contact ${id}`);
    return toContactDto(rows[0]);
  }

  async getMyContact(): Promise<ContactDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!actor.endUserId) throw new CrmInvalidError('end-user identity required');
    const rows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.endUserId, actor.endUserId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`crm_not_found: no contact linked to your end-user record`);
    return toContactDto(rows[0]);
  }

  async findContact(input: { email?: string; phone?: string }): Promise<ContactDto | null> {
    const ctx = getCurrentContext();
    if (!input.email && !input.phone) {
      throw new CrmInvalidError('at least one of email or phone is required');
    }
    const filters: SQL[] = [];
    if (input.email) filters.push(eq(schema.crmContacts.email, input.email));
    if (input.phone) filters.push(eq(schema.crmContacts.phone, input.phone));
    const rows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(or(...filters))
      .limit(1);
    return rows[0] ? toContactDto(rows[0]) : null;
  }

  async createContact(input: {
    name?: string;
    email?: string;
    phone?: string;
    title?: string;
    address?: string;
    companyId?: string;
    endUserId?: string;
    tags?: string[];
    customFields?: Record<string, unknown>;
  }): Promise<ContactDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [row] = await ctx.db
      .insert(schema.crmContacts)
      .values({
        orgId: actor.orgId,
        name: input.name ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        title: input.title ?? null,
        address: input.address ?? null,
        companyId: input.companyId ?? null,
        endUserId: input.endUserId ?? null,
        tags: input.tags ?? [],
        customFields: input.customFields ?? {},
      })
      .returning();
    await this.webhooks.emit({
      type: 'crm.contact.created',
      payload: {
        contactId: row!.id,
        email: row!.email,
        endUserId: row!.endUserId,
      },
    });
    return toContactDto(row!);
  }

  async bulkCreateContacts(
    inputs: Array<Parameters<CrmService['createContact']>[0]>,
  ): Promise<{ created: number; skipped: number }> {
    if (inputs.length === 0) return { created: 0, skipped: 0 };
    if (inputs.length > 500) {
      throw new CrmInvalidError('bulk create capped at 500 rows per call');
    }
    let created = 0;
    let skipped = 0;
    for (const input of inputs) {
      const existing = await this.findContact({
        email: input.email,
        phone: input.phone,
      }).catch(() => null);
      if (existing?.doNotContact) {
        skipped += 1;
        continue;
      }
      if (existing) {
        skipped += 1;
        continue;
      }
      await this.createContact(input);
      created += 1;
    }
    return { created, skipped };
  }

  async updateContact(input: {
    id: string;
    patch: Partial<{
      name: string;
      email: string;
      phone: string;
      title: string;
      address: string;
      companyId: string | null;
      ownerUserId: string | null;
      tags: string[];
      customFields: Record<string, unknown>;
      doNotContact: boolean;
    }>;
  }): Promise<ContactDto> {
    const ctx = getCurrentContext();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(input.patch)) {
      if (v !== undefined) updates[k] = v;
    }
    if (input.patch.doNotContact === false) {
      updates.unsubscribedAt = null;
    } else if (input.patch.doNotContact === true) {
      updates.unsubscribedAt = new Date();
    }
    const result = await ctx.db
      .update(schema.crmContacts)
      .set(updates)
      .where(eq(schema.crmContacts.id, input.id))
      .returning();
    if (!result[0]) throw new NotFoundException(`crm_not_found: contact ${input.id}`);
    await this.webhooks.emit({
      type: 'crm.contact.updated',
      payload: {
        contactId: result[0].id,
        fields: Object.keys(input.patch),
      },
    });
    return toContactDto(result[0]);
  }

  async setAiSummary(input: {
    entityType: 'contact' | 'company' | 'deal';
    id: string;
    summary?: string | null;
    nextAction?: string | null;
  }): Promise<{ ok: true }> {
    const ctx = getCurrentContext();
    const table =
      input.entityType === 'contact'
        ? schema.crmContacts
        : input.entityType === 'company'
          ? schema.crmCompanies
          : schema.crmDeals;
    const updates: Record<string, unknown> = {
      lastAiTouchAt: new Date(),
    };
    if (input.summary !== undefined) {
      updates.aiSummary = input.summary;
      updates.aiSummaryAt = new Date();
    }
    if (input.nextAction !== undefined) updates.aiNextAction = input.nextAction;
    const result = await ctx.db.update(table).set(updates).where(eq(table.id, input.id)).returning({ id: table.id });
    if (!result[0]) {
      throw new NotFoundException(`crm_not_found: ${input.entityType} ${input.id}`);
    }
    return { ok: true };
  }

  async setContactConsent(input: {
    contactId: string;
    lawfulBasis: ConsentLawfulBasis;
    source: string;
    evidence?: Record<string, unknown>;
    givenAt?: string;
  }): Promise<ContactDto> {
    const ctx = getCurrentContext();
    if (!CONSENT_LAWFUL_BASES.includes(input.lawfulBasis)) {
      throw new CrmInvalidError(
        `lawfulBasis must be one of ${CONSENT_LAWFUL_BASES.join(', ')}`,
      );
    }
    const givenAt = input.givenAt ? new Date(input.givenAt) : new Date();
    const result = await ctx.db
      .update(schema.crmContacts)
      .set({
        consentLawfulBasis: input.lawfulBasis,
        consentGivenAt: givenAt,
        consentSource: input.source,
        consentEvidence: input.evidence ?? {},
        updatedAt: new Date(),
      })
      .where(eq(schema.crmContacts.id, input.contactId))
      .returning();
    if (!result[0]) throw new NotFoundException(`crm_not_found: contact ${input.contactId}`);
    await this.logActivity({
      type: 'note',
      contactId: input.contactId,
      subject: 'Consent recorded',
      body: `Lawful basis: ${input.lawfulBasis}; source: ${input.source}`,
      metadata: { consent: { lawfulBasis: input.lawfulBasis, source: input.source, evidence: input.evidence ?? {} } },
    });
    return toContactDto(result[0]);
  }

  // ─── Segments ───────────────────────────────────────────────────────────

  async listSegments(): Promise<SegmentDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmSegments)
      .orderBy(asc(schema.crmSegments.name));
    return rows.map(toSegmentDto);
  }

  async getSegment(id: string): Promise<SegmentDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmSegments)
      .where(eq(schema.crmSegments.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`crm_not_found: segment ${id}`);
    return toSegmentDto(rows[0]);
  }

  async createSegment(input: {
    name: string;
    description?: string;
    filter: SegmentFilter;
  }): Promise<SegmentDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!input.name.trim()) throw new CrmInvalidError('segment name must be non-empty');
    const filter = normaliseFilter(input.filter);
    try {
      const [row] = await ctx.db
        .insert(schema.crmSegments)
        .values({
          orgId: actor.orgId,
          name: input.name,
          description: input.description ?? null,
          filterDefinition: filter,
          createdByActorType: actor.type,
          createdByActorId: actor.id,
        })
        .returning();
      return toSegmentDto(row!);
    } catch (err) {
      if (err instanceof Error && err.message.includes('crm_segments_org_name_uq')) {
        throw new ConflictException(`crm_conflict: segment with name "${input.name}" already exists`);
      }
      throw err;
    }
  }

  async updateSegment(input: {
    id: string;
    patch: Partial<{ name: string; description: string | null; filter: SegmentFilter }>;
  }): Promise<SegmentDto> {
    const ctx = getCurrentContext();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.patch.name !== undefined) updates.name = input.patch.name;
    if (input.patch.description !== undefined) updates.description = input.patch.description;
    if (input.patch.filter !== undefined) updates.filterDefinition = normaliseFilter(input.patch.filter);
    const result = await ctx.db
      .update(schema.crmSegments)
      .set(updates)
      .where(eq(schema.crmSegments.id, input.id))
      .returning();
    if (!result[0]) throw new NotFoundException(`crm_not_found: segment ${input.id}`);
    return toSegmentDto(result[0]);
  }

  async deleteSegment(id: string): Promise<{ deleted: true }> {
    const ctx = getCurrentContext();
    const result = await ctx.db
      .delete(schema.crmSegments)
      .where(eq(schema.crmSegments.id, id))
      .returning({ id: schema.crmSegments.id });
    if (!result[0]) throw new NotFoundException(`crm_not_found: segment ${id}`);
    return { deleted: true };
  }

  /**
   * Resolve a segment to the contacts it currently targets.
   *
   * Always excludes contacts that are suppressed (`do_not_contact = true` or
   * `unsubscribed_at IS NOT NULL`) or that have no recorded lawful basis for
   * outreach (`consent_lawful_basis IS NULL`). These floors are non-overridable
   * from the public surface — they live here so every caller (operator UI,
   * curator skill, future automation) inherits the same compliance posture.
   */
  async listContactsInSegment(input: { id: string; limit?: number }): Promise<ContactDto[]> {
    const segment = await this.getSegment(input.id);
    const limit = clampLimit(input.limit, 100, 500);
    const ctx = getCurrentContext();
    const filters: SQL[] = [
      eq(schema.crmContacts.doNotContact, false),
      sql`${schema.crmContacts.unsubscribedAt} IS NULL`,
      sql`${schema.crmContacts.consentLawfulBasis} IS NOT NULL`,
    ];
    const f = segment.filterDefinition;
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
      filters.push(sql`(${schema.crmContacts.lastContactedAt} IS NULL OR ${schema.crmContacts.lastContactedAt} < ${since})`);
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
    const rows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(and(...filters))
      .orderBy(desc(schema.crmContacts.updatedAt))
      .limit(limit);
    return rows.map(toContactDto);
  }

  // ─── Companies ──────────────────────────────────────────────────────────

  async listCompanies(input: { limit?: number }): Promise<CompanyDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const rows = await ctx.db
      .select()
      .from(schema.crmCompanies)
      .orderBy(desc(schema.crmCompanies.updatedAt))
      .limit(limit);
    return rows.map(toCompanyDto);
  }

  async getCompany(id: string): Promise<CompanyDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmCompanies)
      .where(eq(schema.crmCompanies.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`crm_not_found: company ${id}`);
    return toCompanyDto(rows[0]);
  }

  async createCompany(input: {
    name: string;
    domain?: string;
    tags?: string[];
    customFields?: Record<string, unknown>;
  }): Promise<CompanyDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [row] = await ctx.db
      .insert(schema.crmCompanies)
      .values({
        orgId: actor.orgId,
        name: input.name,
        domain: input.domain ?? null,
        tags: input.tags ?? [],
        customFields: input.customFields ?? {},
      })
      .returning();
    await this.webhooks.emit({
      type: 'crm.company.created',
      payload: { companyId: row!.id, domain: row!.domain },
    });
    return toCompanyDto(row!);
  }

  // ─── Pipelines / stages / deals ─────────────────────────────────────────

  async listPipelines(): Promise<PipelineDto[]> {
    const ctx = getCurrentContext();
    const pipelines = await ctx.db
      .select()
      .from(schema.crmPipelines)
      .orderBy(asc(schema.crmPipelines.position), asc(schema.crmPipelines.name));
    if (pipelines.length === 0) return [];
    const stages = await ctx.db
      .select()
      .from(schema.crmStages)
      .orderBy(asc(schema.crmStages.position));
    const byPipeline = new Map<string, StageDto[]>();
    for (const s of stages) {
      const arr = byPipeline.get(s.pipelineId) ?? [];
      arr.push({
        id: s.id,
        name: s.name,
        position: s.position,
        winLoss: s.winLoss as 'open' | 'won' | 'lost',
      });
      byPipeline.set(s.pipelineId, arr);
    }
    return pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      position: p.position,
      stages: byPipeline.get(p.id) ?? [],
    }));
  }

  async createPipeline(input: {
    name: string;
    slug: string;
    stages: { name: string; winLoss?: 'open' | 'won' | 'lost' }[];
  }): Promise<PipelineDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (input.stages.length === 0) {
      throw new CrmInvalidError('a pipeline must have at least one stage');
    }
    if (!isValidSlug(input.slug)) {
      throw new CrmInvalidError('slug must be lowercase letters, digits and hyphens (1-64 chars)');
    }
    const existing = await ctx.db
      .select({ id: schema.crmPipelines.id })
      .from(schema.crmPipelines)
      .where(and(eq(schema.crmPipelines.orgId, actor.orgId), eq(schema.crmPipelines.slug, input.slug)))
      .limit(1);
    if (existing[0]) throw new ConflictException(`crm_pipeline_slug_conflict: ${input.slug}`);

    const [pipeline] = await ctx.db
      .insert(schema.crmPipelines)
      .values({ orgId: actor.orgId, name: input.name, slug: input.slug })
      .returning();
    await ctx.db.insert(schema.crmStages).values(
      input.stages.map((s, position) => ({
        orgId: actor.orgId,
        pipelineId: pipeline!.id,
        name: s.name,
        position,
        winLoss: s.winLoss ?? 'open',
      })),
    );
    return (await this.listPipelines()).find((p) => p.id === pipeline!.id)!;
  }

  async listDeals(input: {
    pipelineId?: string;
    stageId?: string;
    limit?: number;
  }): Promise<DealDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters: SQL[] = [];
    if (input.pipelineId) filters.push(eq(schema.crmDeals.pipelineId, input.pipelineId));
    if (input.stageId) filters.push(eq(schema.crmDeals.stageId, input.stageId));
    const rows = await ctx.db
      .select()
      .from(schema.crmDeals)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(schema.crmDeals.updatedAt))
      .limit(limit);
    return rows.map(toDealDto);
  }

  async createDeal(input: {
    name: string;
    pipelineId: string;
    stageId?: string;
    amountCents?: number;
    currency?: string;
    primaryContactId?: string;
    companyId?: string;
    expectedCloseAt?: string;
  }): Promise<DealDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    let stageId = input.stageId;
    if (!stageId) {
      const stages = await ctx.db
        .select({ id: schema.crmStages.id })
        .from(schema.crmStages)
        .where(eq(schema.crmStages.pipelineId, input.pipelineId))
        .orderBy(asc(schema.crmStages.position))
        .limit(1);
      if (!stages[0]) throw new NotFoundException(`crm_not_found: pipeline ${input.pipelineId}`);
      stageId = stages[0].id;
    }
    const [row] = await ctx.db
      .insert(schema.crmDeals)
      .values({
        orgId: actor.orgId,
        pipelineId: input.pipelineId,
        stageId,
        name: input.name,
        amountCents: input.amountCents ?? null,
        currency: input.currency ?? null,
        primaryContactId: input.primaryContactId ?? null,
        companyId: input.companyId ?? null,
        expectedCloseAt: input.expectedCloseAt ? new Date(input.expectedCloseAt) : null,
      })
      .returning();
    await this.webhooks.emit({
      type: 'crm.deal.created',
      payload: {
        dealId: row!.id,
        pipelineId: row!.pipelineId,
        stageId: row!.stageId,
        amountCents: row!.amountCents,
      },
    });
    return toDealDto(row!);
  }

  async changeStage(input: { dealId: string; stageId: string }): Promise<DealDto> {
    const ctx = getCurrentContext();
    const stages = await ctx.db
      .select()
      .from(schema.crmStages)
      .where(eq(schema.crmStages.id, input.stageId))
      .limit(1);
    const stage = stages[0];
    if (!stage) throw new NotFoundException(`crm_not_found: stage ${input.stageId}`);
    const updates: Record<string, unknown> = {
      stageId: input.stageId,
      pipelineId: stage.pipelineId,
      updatedAt: new Date(),
    };
    if (stage.winLoss !== 'open') updates.closedAt = new Date();
    const result = await ctx.db
      .update(schema.crmDeals)
      .set(updates)
      .where(eq(schema.crmDeals.id, input.dealId))
      .returning();
    if (!result[0]) throw new NotFoundException(`crm_not_found: deal ${input.dealId}`);
    await this.webhooks.emit({
      type: 'crm.deal.stage_changed',
      payload: {
        dealId: result[0].id,
        stageId: input.stageId,
        winLoss: stage.winLoss,
        closedAt: result[0].closedAt?.toISOString() ?? null,
      },
    });
    return toDealDto(result[0]);
  }

  // ─── Activities ─────────────────────────────────────────────────────────

  async logActivity(input: {
    type: ActivityType;
    subject?: string;
    body?: string;
    contactId?: string;
    companyId?: string;
    dealId?: string;
    dueAt?: string;
    completedAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ActivityDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [row] = await ctx.db
      .insert(schema.crmActivities)
      .values({
        orgId: actor.orgId,
        type: input.type,
        subject: input.subject ?? null,
        body: input.body ?? null,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        endUserId: actor.endUserId ?? null,
        actorType: actor.type === 'user' ? 'user' : actor.type === 'end_user_agent' ? 'end_user' : 'agent',
        actorId: actor.id,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
        metadata: input.metadata ?? {},
      })
      .returning();
    if (input.contactId) {
      await ctx.db
        .update(schema.crmContacts)
        .set({ lastContactedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.crmContacts.id, input.contactId));
    }
    await this.webhooks.emit({
      type: 'crm.activity.logged',
      payload: {
        activityId: row!.id,
        kind: row!.type,
        contactId: row!.contactId,
        dealId: row!.dealId,
        companyId: row!.companyId,
      },
    });
    return toActivityDto(row!);
  }

  async listActivities(input: {
    contactId?: string;
    dealId?: string;
    companyId?: string;
    limit?: number;
  }): Promise<ActivityDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters: SQL[] = [];
    if (input.contactId) filters.push(eq(schema.crmActivities.contactId, input.contactId));
    if (input.dealId) filters.push(eq(schema.crmActivities.dealId, input.dealId));
    if (input.companyId) filters.push(eq(schema.crmActivities.companyId, input.companyId));
    const rows = await ctx.db
      .select()
      .from(schema.crmActivities)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(schema.crmActivities.createdAt))
      .limit(limit);
    return rows.map(toActivityDto);
  }

  // ─── Search ─────────────────────────────────────────────────────────────

  async searchContacts(input: { query: string; limit?: number }): Promise<ContactDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 25, 100);
    const trimmed = input.query.trim();
    if (!trimmed) return [];
    const rows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(
        or(
          ilike(schema.crmContacts.name, `%${trimmed}%`),
          ilike(schema.crmContacts.email, `%${trimmed}%`),
          ilike(schema.crmContacts.phone, `%${trimmed}%`),
          ilike(schema.crmContacts.title, `%${trimmed}%`),
        ),
      )
      .orderBy(desc(schema.crmContacts.updatedAt))
      .limit(limit);
    return rows.map(toContactDto);
  }

  // ─── Merge proposals ────────────────────────────────────────────────────

  async proposeMerge(input: {
    contactAId: string;
    contactBId: string;
    confidence: MergeConfidence;
    evidence: Record<string, unknown>;
    recommendedKeeperId: string;
    recommendedPatch?: Record<string, unknown>;
  }): Promise<MergeProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (input.contactAId === input.contactBId) {
      throw new CrmInvalidError('cannot propose a merge between a contact and itself');
    }
    const [a, b] = canonicalizePair(input.contactAId, input.contactBId);
    const contacts = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(or(eq(schema.crmContacts.id, a), eq(schema.crmContacts.id, b)));
    const contactA = contacts.find((r) => r.id === a);
    const contactB = contacts.find((r) => r.id === b);
    if (!contactA) throw new NotFoundException(`crm_not_found: contact ${a}`);
    if (!contactB) throw new NotFoundException(`crm_not_found: contact ${b}`);
    if (input.recommendedKeeperId !== a && input.recommendedKeeperId !== b) {
      throw new CrmInvalidError('recommendedKeeperId must be one of the two contacts');
    }

    const existingPending = await ctx.db
      .select()
      .from(schema.crmMergeProposals)
      .where(
        and(
          eq(schema.crmMergeProposals.contactAId, a),
          eq(schema.crmMergeProposals.contactBId, b),
          eq(schema.crmMergeProposals.status, 'pending'),
        ),
      )
      .limit(1);

    if (existingPending[0]) {
      const [updated] = await ctx.db
        .update(schema.crmMergeProposals)
        .set({
          confidence: input.confidence,
          evidence: input.evidence,
          recommendedKeeperId: input.recommendedKeeperId,
          recommendedPatch: input.recommendedPatch ?? {},
          updatedAt: new Date(),
        })
        .where(eq(schema.crmMergeProposals.id, existingPending[0].id))
        .returning();
      const dto = toMergeProposalDto(updated!, contactA, contactB);
      await this.emitMergeEvent('crm.merge_proposal.proposed', dto);
      return dto;
    }

    const [row] = await ctx.db
      .insert(schema.crmMergeProposals)
      .values({
        orgId: actor.orgId,
        contactAId: a,
        contactBId: b,
        confidence: input.confidence,
        evidence: input.evidence,
        recommendedKeeperId: input.recommendedKeeperId,
        recommendedPatch: input.recommendedPatch ?? {},
        status: 'pending',
        proposedByActorType: actor.type === 'user' ? 'user' : 'agent',
        proposedByActorId: actor.id,
      })
      .returning();
    const dto = toMergeProposalDto(row!, contactA, contactB);
    await this.emitMergeEvent('crm.merge_proposal.proposed', dto);
    return dto;
  }

  async listMergeProposals(input: {
    status?: MergeStatus;
    limit?: number;
  }): Promise<MergeProposalDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const status = input.status ?? 'pending';
    const proposals = await ctx.db
      .select()
      .from(schema.crmMergeProposals)
      .where(eq(schema.crmMergeProposals.status, status))
      .orderBy(desc(schema.crmMergeProposals.createdAt))
      .limit(limit);
    if (proposals.length === 0) return [];
    const ids = new Set<string>();
    for (const p of proposals) {
      ids.add(p.contactAId);
      ids.add(p.contactBId);
    }
    const contactRows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(or(...Array.from(ids).map((id) => eq(schema.crmContacts.id, id))));
    const byId = new Map(contactRows.map((r) => [r.id, r]));
    return proposals.map((p) => {
      const a = byId.get(p.contactAId);
      const b = byId.get(p.contactBId);
      if (!a || !b) {
        throw new CrmInvalidError(`merge proposal ${p.id} references missing contact`);
      }
      return toMergeProposalDto(p, a, b);
    });
  }

  async getMergeProposal(id: string): Promise<MergeProposalDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmMergeProposals)
      .where(eq(schema.crmMergeProposals.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`crm_not_found: merge proposal ${id}`);
    const proposal = rows[0];
    const contacts = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(or(eq(schema.crmContacts.id, proposal.contactAId), eq(schema.crmContacts.id, proposal.contactBId)));
    const a = contacts.find((r) => r.id === proposal.contactAId);
    const b = contacts.find((r) => r.id === proposal.contactBId);
    if (!a || !b) {
      throw new CrmInvalidError(`merge proposal ${id} references missing contact`);
    }
    return toMergeProposalDto(proposal, a, b);
  }

  async applyMergeProposal(input: { id: string }): Promise<MergeProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.crmMergeProposals)
      .where(eq(schema.crmMergeProposals.id, input.id))
      .limit(1);
    const proposal = rows[0];
    if (!proposal) throw new NotFoundException(`crm_not_found: merge proposal ${input.id}`);
    if (proposal.status !== 'pending') {
      throw new CrmInvalidError(`merge proposal ${input.id} is ${proposal.status}, not pending`);
    }
    const keeperId = proposal.recommendedKeeperId;
    const duplicateId = keeperId === proposal.contactAId ? proposal.contactBId : proposal.contactAId;
    const contactRows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(or(eq(schema.crmContacts.id, keeperId), eq(schema.crmContacts.id, duplicateId)));
    const keeperRow = contactRows.find((r) => r.id === keeperId);
    const duplicateRow = contactRows.find((r) => r.id === duplicateId);
    if (!keeperRow || !duplicateRow) {
      throw new CrmInvalidError(`merge proposal ${input.id} references missing contact`);
    }

    const patch = proposal.recommendedPatch ?? {};
    const keeperUpdates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) keeperUpdates[k] = v;
    }
    if (!keeperRow.endUserId && duplicateRow.endUserId) {
      keeperUpdates['endUserId'] = duplicateRow.endUserId;
    }
    if (Object.keys(keeperUpdates).length > 1) {
      await ctx.db
        .update(schema.crmContacts)
        .set(keeperUpdates)
        .where(eq(schema.crmContacts.id, keeperId));
    }

    await ctx.db
      .update(schema.crmActivities)
      .set({ contactId: keeperId })
      .where(eq(schema.crmActivities.contactId, duplicateId));

    await ctx.db
      .update(schema.crmDeals)
      .set({ primaryContactId: keeperId, updatedAt: new Date() })
      .where(eq(schema.crmDeals.primaryContactId, duplicateId));

    await ctx.db
      .update(schema.crmRelationships)
      .set({ fromId: keeperId })
      .where(
        and(
          eq(schema.crmRelationships.fromType, 'contact'),
          eq(schema.crmRelationships.fromId, duplicateId),
        ),
      );
    await ctx.db
      .update(schema.crmRelationships)
      .set({ toId: keeperId })
      .where(
        and(
          eq(schema.crmRelationships.toType, 'contact'),
          eq(schema.crmRelationships.toId, duplicateId),
        ),
      );

    const archiveTag = `dedup-archived-${archiveMonth(new Date())}`;
    const dupTags = duplicateRow.tags.includes(archiveTag)
      ? duplicateRow.tags
      : [...duplicateRow.tags, archiveTag];
    const dupCustomFields = {
      ...duplicateRow.customFields,
      mergedInto: keeperId,
      mergedAt: new Date().toISOString(),
    };
    const dupUpdates: Record<string, unknown> = {
      tags: dupTags,
      customFields: dupCustomFields,
      doNotContact: true,
      updatedAt: new Date(),
    };
    if (duplicateRow.endUserId) {
      dupUpdates['endUserId'] = null;
    }
    await ctx.db
      .update(schema.crmContacts)
      .set(dupUpdates)
      .where(eq(schema.crmContacts.id, duplicateId));

    const [updatedProposal] = await ctx.db
      .update(schema.crmMergeProposals)
      .set({
        status: 'applied',
        decidedByActorType: actor.type === 'user' ? 'user' : 'agent',
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.crmMergeProposals.id, input.id))
      .returning();

    const refreshed = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(or(eq(schema.crmContacts.id, keeperId), eq(schema.crmContacts.id, duplicateId)));
    const a = refreshed.find((r) => r.id === proposal.contactAId);
    const b = refreshed.find((r) => r.id === proposal.contactBId);
    const dto = toMergeProposalDto(updatedProposal!, a!, b!);
    await this.emitMergeEvent('crm.merge_proposal.applied', dto);
    return dto;
  }

  async dismissMergeProposal(input: { id: string; reason?: string }): Promise<MergeProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.crmMergeProposals)
      .where(eq(schema.crmMergeProposals.id, input.id))
      .limit(1);
    const proposal = rows[0];
    if (!proposal) throw new NotFoundException(`crm_not_found: merge proposal ${input.id}`);
    if (proposal.status !== 'pending') {
      throw new CrmInvalidError(`merge proposal ${input.id} is ${proposal.status}, not pending`);
    }
    const [updated] = await ctx.db
      .update(schema.crmMergeProposals)
      .set({
        status: 'dismissed',
        dismissReason: input.reason ?? null,
        decidedByActorType: actor.type === 'user' ? 'user' : 'agent',
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.crmMergeProposals.id, input.id))
      .returning();
    const contactRows = await ctx.db
      .select()
      .from(schema.crmContacts)
      .where(or(eq(schema.crmContacts.id, proposal.contactAId), eq(schema.crmContacts.id, proposal.contactBId)));
    const a = contactRows.find((r) => r.id === proposal.contactAId);
    const b = contactRows.find((r) => r.id === proposal.contactBId);
    if (!a || !b) {
      throw new CrmInvalidError(`merge proposal ${input.id} references missing contact`);
    }
    const dto = toMergeProposalDto(updated!, a, b);
    await this.emitMergeEvent('crm.merge_proposal.dismissed', dto);
    return dto;
  }

  private async emitMergeEvent(
    type: 'crm.merge_proposal.proposed' | 'crm.merge_proposal.applied' | 'crm.merge_proposal.dismissed',
    proposal: MergeProposalDto,
  ): Promise<void> {
    await this.webhooks.emit({
      type,
      payload: {
        id: proposal.id,
        contactAId: proposal.contactA.id,
        contactBId: proposal.contactB.id,
        recommendedKeeperId: proposal.recommendedKeeperId,
        confidence: proposal.confidence,
        status: proposal.status,
        decidedByActorType: proposal.decidedByActorType,
        decidedByActorId: proposal.decidedByActorId,
        decidedAt: proposal.decidedAt,
      },
    });
  }
}

// ─── DTO mappers / helpers ─────────────────────────────────────────────────

function toContactDto(row: typeof schema.crmContacts.$inferSelect): ContactDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    title: row.title,
    address: row.address,
    companyId: row.companyId,
    endUserId: row.endUserId,
    ownerUserId: row.ownerUserId,
    tags: row.tags,
    customFields: row.customFields,
    aiSummary: row.aiSummary,
    aiNextAction: row.aiNextAction,
    engagementScore: row.engagementScore,
    doNotContact: row.doNotContact,
    unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
    lastContactedAt: row.lastContactedAt?.toISOString() ?? null,
    consentLawfulBasis: (row.consentLawfulBasis as ConsentLawfulBasis | null) ?? null,
    consentGivenAt: row.consentGivenAt?.toISOString() ?? null,
    consentSource: row.consentSource,
    consentEvidence: row.consentEvidence ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSegmentDto(row: typeof schema.crmSegments.$inferSelect): SegmentDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    filterDefinition: row.filterDefinition,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCompanyDto(row: typeof schema.crmCompanies.$inferSelect): CompanyDto {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    ownerUserId: row.ownerUserId,
    tags: row.tags,
    customFields: row.customFields,
    aiSummary: row.aiSummary,
    aiNextAction: row.aiNextAction,
    engagementScore: row.engagementScore,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDealDto(row: typeof schema.crmDeals.$inferSelect): DealDto {
  return {
    id: row.id,
    name: row.name,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    amountCents: row.amountCents,
    currency: row.currency,
    primaryContactId: row.primaryContactId,
    companyId: row.companyId,
    ownerUserId: row.ownerUserId,
    expectedCloseAt: row.expectedCloseAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    aiSummary: row.aiSummary,
    aiNextAction: row.aiNextAction,
    engagementScore: row.engagementScore,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toActivityDto(row: typeof schema.crmActivities.$inferSelect): ActivityDto {
  return {
    id: row.id,
    type: row.type as ActivityType,
    subject: row.subject,
    body: row.body,
    contactId: row.contactId,
    companyId: row.companyId,
    dealId: row.dealId,
    endUserId: row.endUserId,
    actorType: row.actorType,
    actorId: row.actorId,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toContactSummary(row: typeof schema.crmContacts.$inferSelect): MergeProposalContactSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    companyId: row.companyId,
    endUserId: row.endUserId,
  };
}

function toMergeProposalDto(
  row: typeof schema.crmMergeProposals.$inferSelect,
  contactA: typeof schema.crmContacts.$inferSelect,
  contactB: typeof schema.crmContacts.$inferSelect,
): MergeProposalDto {
  return {
    id: row.id,
    contactA: toContactSummary(contactA),
    contactB: toContactSummary(contactB),
    confidence: row.confidence as MergeConfidence,
    evidence: row.evidence,
    recommendedKeeperId: row.recommendedKeeperId,
    recommendedPatch: row.recommendedPatch,
    status: row.status as MergeStatus,
    dismissReason: row.dismissReason,
    proposedByActorType: row.proposedByActorType,
    proposedByActorId: row.proposedByActorId,
    decidedByActorType: row.decidedByActorType,
    decidedByActorId: row.decidedByActorId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function canonicalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function archiveMonth(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function normaliseFilter(input: SegmentFilter): SegmentFilter {
  const out: SegmentFilter = {};
  if (input.tagsAny && input.tagsAny.length > 0) out.tagsAny = [...input.tagsAny];
  if (input.tagsAll && input.tagsAll.length > 0) out.tagsAll = [...input.tagsAll];
  if (input.companyId) out.companyId = input.companyId;
  if (input.searchQuery && input.searchQuery.trim()) out.searchQuery = input.searchQuery.trim();
  if (input.contactedSince) out.contactedSince = input.contactedSince;
  return out;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}
