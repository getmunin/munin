import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { LLM_AVAILABILITY, type LlmAvailability } from './llm-availability.ts';
import { createHash } from 'node:crypto';
import { schema } from '@getmunin/db';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import {
  parseJourneySpec,
  validateJourneySpec,
  type JourneyReferences,
  type JourneyValidation,
} from './journey-validator.ts';

export const JOURNEY_STATUSES = ['draft', 'live', 'paused', 'archived'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

type RawSpec = Record<string, unknown>;
type RawNode = Record<string, unknown> & { id: string };

export interface JourneyDto {
  id: string;
  name: string;
  description: string | null;
  outreachCampaignId: string;
  status: JourneyStatus;
  liveVersion: number | null;
  draftVersion: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface JourneyVersionDto {
  number: number;
  parentVersion: number | null;
  changeSummary: string | null;
  spec: RawSpec;
  specHash: string;
  validation: JourneyValidation | null;
  createdBy: { type: string; id: string };
  publishRequestedAt: string | null;
  publishedAt: string | null;
  publishedByActorId: string | null;
  createdAt: string;
}

export type JourneyVersionSummaryDto = Omit<JourneyVersionDto, 'spec'>;

export interface JourneyDetailDto extends JourneyDto {
  draft: JourneyVersionDto | null;
  live: JourneyVersionDto | null;
}

const EMPTY_SPEC: RawSpec = {
  entry: { trigger: { type: 'manual' } },
  start: 'done',
  nodes: [{ id: 'done', type: 'exit', reason: 'reached_end' }],
};

@Injectable()
export class JourneysService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Optional() @Inject(LLM_AVAILABILITY) private readonly llm: LlmAvailability | null = null,
  ) {}

  async list(input: { status?: JourneyStatus; limit?: number } = {}): Promise<JourneyDto[]> {
    const ctx = getCurrentContext();
    const j = schema.journeys;
    const rows = await ctx.db
      .select()
      .from(j)
      .where(
        and(
          eq(j.orgId, ctx.actor!.orgId),
          input.status ? eq(j.status, input.status) : ne(j.status, 'archived'),
        ),
      )
      .orderBy(desc(j.updatedAt))
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
    const drafts = await this.draftNumbers(rows.map((r) => r.id));
    return rows.map((r) => toJourneyDto(r, drafts.get(r.id) ?? null));
  }

  async get(id: string): Promise<JourneyDetailDto> {
    const row = await this.load(id);
    const versions = await this.versionRows(id);
    const draft = versions.find((v) => !v.publishedAt) ?? null;
    const live = row.liveVersion
      ? (versions.find((v) => v.number === row.liveVersion) ?? null)
      : null;
    return {
      ...toJourneyDto(row, draft?.number ?? null),
      draft: draft ? toVersionDto(draft) : null,
      live: live ? toVersionDto(live) : null,
    };
  }

  async listVersions(id: string): Promise<JourneyVersionSummaryDto[]> {
    await this.load(id);
    const rows = await this.versionRows(id);
    return rows.map((r) => {
      const { spec: _spec, ...rest } = toVersionDto(r);
      return rest;
    });
  }

  async getVersion(id: string, number: number): Promise<JourneyVersionDto> {
    await this.load(id);
    const row = await this.versionRow(id, number);
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${id} has no version ${number}`);
    return toVersionDto(row);
  }

  async create(input: {
    name: string;
    description?: string;
    outreachCampaignId: string;
    spec?: RawSpec;
  }): Promise<JourneyDetailDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const orgId = actor.orgId;
    const [campaign] = await ctx.db
      .select({ id: schema.outreachCampaigns.id, channelType: schema.convChannels.type })
      .from(schema.outreachCampaigns)
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.outreachCampaigns.channelId))
      .where(and(eq(schema.outreachCampaigns.orgId, orgId), eq(schema.outreachCampaigns.id, input.outreachCampaignId)))
      .limit(1);
    if (!campaign) {
      throw new NotFoundException(`journeys_not_found: outreach campaign ${input.outreachCampaignId}`);
    }
    if (campaign.channelType !== 'email') {
      throw new BadRequestException(
        `journeys_invalid: journeys run on email campaigns for now; campaign ${campaign.id} uses ${campaign.channelType}`,
      );
    }
    const [taken] = await ctx.db
      .select({ id: schema.journeys.id, name: schema.journeys.name, campaignId: schema.journeys.outreachCampaignId })
      .from(schema.journeys)
      .where(
        and(
          eq(schema.journeys.orgId, orgId),
          sql`(${schema.journeys.name} = ${input.name} OR ${schema.journeys.outreachCampaignId} = ${input.outreachCampaignId})`,
        ),
      )
      .limit(1);
    if (taken) {
      throw new ConflictException(
        taken.campaignId === input.outreachCampaignId
          ? `journeys_conflict: campaign ${input.outreachCampaignId} already has journey ${taken.id}`
          : `journeys_conflict: a journey named "${input.name}" already exists`,
      );
    }

    const [journey] = await ctx.db
      .insert(schema.journeys)
      .values({
        orgId,
        outreachCampaignId: input.outreachCampaignId,
        name: input.name,
        description: input.description ?? null,
        createdByActorType: actor.type,
        createdByActorId: actor.id,
      })
      .returning();
    await this.insertVersion(journey!.id, 1, input.spec ?? EMPTY_SPEC, null, 'Created');
    await this.webhooks.emit({
      type: 'journey.created',
      payload: { journeyId: journey!.id, outreachCampaignId: input.outreachCampaignId, name: input.name },
    });
    return this.get(journey!.id);
  }

  async replaceDraft(id: string, spec: RawSpec, changeSummary?: string): Promise<JourneyVersionDto> {
    return this.editDraft(id, () => spec, changeSummary ?? 'Replaced spec');
  }

  async addNode(id: string, node: RawNode, after?: { nodeId: string; edge?: string }): Promise<JourneyVersionDto> {
    return this.editDraft(
      id,
      (spec) => {
        const nodes = specNodes(spec);
        if (nodes.some((n) => n.id === node.id)) {
          throw new ConflictException(`journeys_conflict: node "${node.id}" already exists`);
        }
        const next = { ...spec, nodes: [...nodes, node] };
        if (after) {
          const nodesWithLink = next.nodes.map((n) =>
            n.id === after.nodeId ? { ...n, [after.edge ?? 'next']: node.id } : n,
          );
          if (!nodes.some((n) => n.id === after.nodeId)) {
            throw new NotFoundException(`journeys_not_found: node "${after.nodeId}"`);
          }
          return { ...next, nodes: nodesWithLink };
        }
        return next;
      },
      `Added node ${node.id}`,
    );
  }

  async updateNode(id: string, node: RawNode): Promise<JourneyVersionDto> {
    return this.editDraft(
      id,
      (spec) => {
        const nodes = specNodes(spec);
        if (!nodes.some((n) => n.id === node.id)) {
          throw new NotFoundException(`journeys_not_found: node "${node.id}"`);
        }
        return { ...spec, nodes: nodes.map((n) => (n.id === node.id ? node : n)) };
      },
      `Updated node ${node.id}`,
    );
  }

  async removeNode(id: string, nodeId: string): Promise<JourneyVersionDto> {
    return this.editDraft(
      id,
      (spec) => {
        const nodes = specNodes(spec);
        if (!nodes.some((n) => n.id === nodeId)) {
          throw new NotFoundException(`journeys_not_found: node "${nodeId}"`);
        }
        return { ...spec, nodes: nodes.filter((n) => n.id !== nodeId) };
      },
      `Removed node ${nodeId}`,
    );
  }

  async updateSettings(
    id: string,
    patch: { start?: string; entry?: unknown; exit?: unknown; goal?: unknown; settings?: unknown },
  ): Promise<JourneyVersionDto> {
    return this.editDraft(
      id,
      (spec) => {
        const next = { ...spec };
        for (const key of ['start', 'entry', 'exit', 'goal', 'settings'] as const) {
          if (patch[key] !== undefined) next[key] = patch[key];
        }
        return next;
      },
      `Updated ${Object.keys(patch).join(', ')}`,
    );
  }

  async restoreVersion(id: string, number: number): Promise<JourneyVersionDto> {
    const source = await this.versionRow(id, number);
    if (!source) throw new NotFoundException(`journeys_not_found: journey ${id} has no version ${number}`);
    return this.editDraft(id, () => source.spec, `Restored version ${number}`);
  }

  async validate(id: string, number?: number): Promise<JourneyValidation & { version: number }> {
    await this.load(id);
    const row = number ? await this.versionRow(id, number) : await this.latestVersion(id);
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${id} has no version ${number}`);
    const validation = await this.validateSpec(row.spec);
    if (!row.publishedAt) {
      const ctx = getCurrentContext();
      await ctx.db
        .update(schema.journeyVersions)
        .set({ validation: validation as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(schema.journeyVersions.id, row.id));
    }
    return { version: row.number, ...validation };
  }

  async validateSpec(spec: unknown): Promise<JourneyValidation> {
    const parsed = parseJourneySpec(spec);
    if (!parsed.spec) return parsed.validation;
    return validateJourneySpec(parsed.spec, await this.loadReferences());
  }

  async pause(id: string): Promise<JourneyDto> {
    return this.transition(id, ['live'], 'paused', 'journey.paused');
  }

  async resume(id: string): Promise<JourneyDto> {
    return this.transition(id, ['paused'], 'live', 'journey.resumed');
  }

  async archive(id: string): Promise<JourneyDto> {
    return this.transition(id, ['draft', 'live', 'paused'], 'archived', 'journey.archived');
  }

  private async transition(
    id: string,
    from: readonly JourneyStatus[],
    to: JourneyStatus,
    eventType: string,
  ): Promise<JourneyDto> {
    const row = await this.load(id);
    if (!from.includes(row.status as JourneyStatus)) {
      throw new ConflictException(
        `journeys_conflict: journey ${id} is ${row.status}; it must be ${from.join(' or ')} to become ${to}`,
      );
    }
    const ctx = getCurrentContext();
    const now = new Date();
    const [updated] = await ctx.db
      .update(schema.journeys)
      .set({ status: to, updatedAt: now, ...(to === 'archived' ? { archivedAt: now } : {}) })
      .where(eq(schema.journeys.id, id))
      .returning();
    await this.webhooks.emit({ type: eventType, payload: { journeyId: id, from: row.status, to } });
    const drafts = await this.draftNumbers([id]);
    return toJourneyDto(updated!, drafts.get(id) ?? null);
  }

  private async editDraft(
    id: string,
    edit: (spec: RawSpec) => RawSpec,
    summary: string,
  ): Promise<JourneyVersionDto> {
    const journey = await this.load(id);
    if (journey.status === 'archived') {
      throw new ConflictException(`journeys_conflict: journey ${id} is archived`);
    }
    const latest = await this.latestVersion(id);
    const ctx = getCurrentContext();
    if (latest && !latest.publishedAt) {
      const spec = edit(latest.spec);
      const [row] = await ctx.db
        .update(schema.journeyVersions)
        .set({
          spec,
          specHash: hashSpec(spec),
          changeSummary: appendSummary(latest.changeSummary, summary),
          validation: null,
          publishFingerprint: null,
          publishRequestedAt: null,
          publishRequestedByActorType: null,
          publishRequestedByActorId: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.journeyVersions.id, latest.id))
        .returning();
      return toVersionDto(row!);
    }
    const base = latest?.spec ?? EMPTY_SPEC;
    const row = await this.insertVersion(id, (latest?.number ?? 0) + 1, edit(base), latest?.number ?? null, summary);
    return toVersionDto(row);
  }

  private async insertVersion(
    journeyId: string,
    number: number,
    spec: RawSpec,
    parentVersion: number | null,
    changeSummary: string,
  ) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [row] = await ctx.db
      .insert(schema.journeyVersions)
      .values({
        orgId: actor.orgId,
        journeyId,
        number,
        spec,
        specHash: hashSpec(spec),
        parentVersion,
        changeSummary,
        createdByActorType: actor.type,
        createdByActorId: actor.id,
      })
      .returning();
    return row!;
  }

  private async load(id: string) {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.journeys)
      .where(and(eq(schema.journeys.orgId, ctx.actor!.orgId), eq(schema.journeys.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${id}`);
    return row;
  }

  private async versionRows(journeyId: string) {
    const ctx = getCurrentContext();
    return ctx.db
      .select()
      .from(schema.journeyVersions)
      .where(eq(schema.journeyVersions.journeyId, journeyId))
      .orderBy(desc(schema.journeyVersions.number));
  }

  private async versionRow(journeyId: string, number: number) {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.journeyVersions)
      .where(and(eq(schema.journeyVersions.journeyId, journeyId), eq(schema.journeyVersions.number, number)))
      .limit(1);
    return row ?? null;
  }

  private async latestVersion(journeyId: string) {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.journeyVersions)
      .where(eq(schema.journeyVersions.journeyId, journeyId))
      .orderBy(desc(schema.journeyVersions.number))
      .limit(1);
    return row ?? null;
  }

  private async draftNumbers(journeyIds: string[]): Promise<Map<string, number>> {
    if (journeyIds.length === 0) return new Map();
    const ctx = getCurrentContext();
    const v = schema.journeyVersions;
    const rows = await ctx.db
      .select({ journeyId: v.journeyId, number: v.number })
      .from(v)
      .where(and(sql`${v.journeyId} IN ${journeyIds}`, isNull(v.publishedAt)));
    return new Map(rows.map((r) => [r.journeyId, r.number]));
  }

  private async loadReferences(): Promise<JourneyReferences> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const [segments, templates, webhooks, smsChannels] = await Promise.all([
      ctx.db.select({ id: schema.crmSegments.id }).from(schema.crmSegments).where(eq(schema.crmSegments.orgId, orgId)),
      ctx.db
        .select({ id: schema.outreachEmailTemplates.id })
        .from(schema.outreachEmailTemplates)
        .where(eq(schema.outreachEmailTemplates.orgId, orgId)),
      ctx.db.select({ id: schema.webhooks.id }).from(schema.webhooks).where(eq(schema.webhooks.orgId, orgId)),
      ctx.db
        .select({ id: schema.convChannels.id })
        .from(schema.convChannels)
        .where(and(eq(schema.convChannels.orgId, orgId), eq(schema.convChannels.type, 'sms'))),
    ]);
    return {
      segmentIds: new Set(segments.map((r) => r.id)),
      emailTemplateIds: new Set(templates.map((r) => r.id)),
      webhookIds: new Set(webhooks.map((r) => r.id)),
      smsChannelIds: new Set(smsChannels.map((r) => r.id)),
      llmConfigured: this.llm ? await this.llm.providerConfigured().catch(() => undefined) : undefined,
    };
  }
}

export function hashSpec(spec: unknown): string {
  return createHash('sha256').update(canonicalJson(spec), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function specNodes(spec: RawSpec): RawNode[] {
  return Array.isArray(spec.nodes) ? (spec.nodes as RawNode[]) : [];
}

function appendSummary(existing: string | null, next: string): string {
  const lines = existing ? existing.split('\n') : [];
  lines.push(next);
  return lines.slice(-20).join('\n');
}

type JourneyRow = typeof schema.journeys.$inferSelect;
type VersionRow = typeof schema.journeyVersions.$inferSelect;

function toJourneyDto(row: JourneyRow, draftVersion: number | null): JourneyDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    outreachCampaignId: row.outreachCampaignId,
    status: row.status as JourneyStatus,
    liveVersion: row.liveVersion,
    draftVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function toVersionDto(row: VersionRow): JourneyVersionDto {
  return {
    number: row.number,
    parentVersion: row.parentVersion,
    changeSummary: row.changeSummary,
    spec: row.spec,
    specHash: row.specHash,
    validation: (row.validation as unknown as JourneyValidation | null) ?? null,
    createdBy: { type: row.createdByActorType, id: row.createdByActorId },
    publishRequestedAt: row.publishRequestedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedByActorId: row.publishedByActorId,
    createdAt: row.createdAt.toISOString(),
  };
}
