import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@munin/db';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';

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

@Injectable()
export class CrmService {
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

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}
