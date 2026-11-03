import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, readApiBaseUrl } from '@getmunin/core';
import { JourneySpecSchema, stripTrailingSlashes } from '@getmunin/types';
import {
  renderEmail,
  validateEmailTemplate,
  type EmailContent,
  type RenderedEmail,
} from './email-template-render.ts';
import { OutreachInvalidError } from './outreach.service.ts';

export interface EmailTemplateSummaryDto {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateBroadcastUseDto {
  id: string;
  name: string;
  status: string;
  viaDefault: boolean;
}

export interface EmailTemplateJourneyStepUseDto {
  journeyId: string;
  journeyName: string;
  version: number;
  versionRole: 'live' | 'draft' | 'in_flight';
  nodeId: string;
  viaDefault: boolean;
}

export interface EmailTemplateUsageDto {
  broadcasts: EmailTemplateBroadcastUseDto[];
  broadcastTotal: number;
  journeySteps: EmailTemplateJourneyStepUseDto[];
  queuedJourneyEmails: number;
  queuedJourneyEmailsViaDefault: number;
}

export interface EmailTemplateDto extends EmailTemplateSummaryDto {
  mjml: string;
  warnings: string[];
  usage: EmailTemplateUsageDto;
}

const BROADCAST_LIST_LIMIT = 50;
const OPEN_BROADCAST_STATUSES = ['pending', 'approved', 'sending'];
const OPEN_PROPOSAL_STATUSES = ['pending', 'approved'];
const RUNNING_ENROLLMENT_STATES = ['active', 'waiting'];

export interface EmailTemplatePreviewDto extends RenderedEmail {
  templateId: string | null;
}

type TemplateRow = typeof schema.outreachEmailTemplates.$inferSelect;

@Injectable()
export class OutreachEmailTemplatesService {
  async listTemplates(): Promise<EmailTemplateSummaryDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.outreachEmailTemplates)
      .orderBy(desc(schema.outreachEmailTemplates.isDefault), asc(schema.outreachEmailTemplates.name));
    return rows.map(toSummaryDto);
  }

  async getTemplate(id: string): Promise<EmailTemplateDto> {
    const row = await this.loadTemplate(id);
    const { warnings } = await validateEmailTemplate(row.mjml);
    return toDto(row, warnings, await this.usage(row));
  }

  async createTemplate(input: {
    name: string;
    description?: string | null;
    mjml: string;
    isDefault?: boolean;
  }): Promise<EmailTemplateDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const name = input.name.trim();
    if (!name) throw new OutreachInvalidError('name must be non-empty');
    const { warnings } = await validateEmailTemplate(input.mjml);
    await this.assertNameFree(name);
    if (input.isDefault) await this.clearDefault();
    const [row] = await ctx.db
      .insert(schema.outreachEmailTemplates)
      .values({
        orgId: actor.orgId,
        name,
        description: input.description?.trim() || null,
        mjml: input.mjml,
        isDefault: input.isDefault ?? false,
        createdByActorType: actor.type,
        createdByActorId: actor.id,
      })
      .returning();
    return toDto(row!, warnings, await this.usage(row!));
  }

  async updateTemplate(input: {
    id: string;
    name?: string;
    description?: string | null;
    mjml?: string;
    isDefault?: boolean;
  }): Promise<EmailTemplateDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await this.loadTemplate(input.id);
    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && !name) throw new OutreachInvalidError('name must be non-empty');
    const { warnings } = await validateEmailTemplate(input.mjml ?? existing.mjml);
    if (name !== undefined && name !== existing.name) await this.assertNameFree(name, existing.id);
    if (input.isDefault === true && !existing.isDefault) await this.clearDefault();
    const [row] = await ctx.db
      .update(schema.outreachEmailTemplates)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.mjml !== undefined ? { mjml: input.mjml } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        updatedByActorType: actor.type,
        updatedByActorId: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.outreachEmailTemplates.id, existing.id))
      .returning();
    return toDto(row!, warnings, await this.usage(row!));
  }

  async deleteTemplate(id: string): Promise<{ deleted: true; id: string }> {
    const ctx = getCurrentContext();
    const existing = await this.loadTemplate(id);
    const usage = await this.usage(existing);
    const [explicitBroadcasts] = await ctx.db
      .select({ n: count() })
      .from(schema.outreachBroadcasts)
      .where(eq(schema.outreachBroadcasts.emailTemplateId, existing.id));
    const broadcasts = explicitBroadcasts?.n ?? 0;
    const steps = usage.journeySteps.filter((s) => !s.viaDefault);
    if (broadcasts > 0 || steps.length > 0 || usage.queuedJourneyEmails > 0) {
      const examples = [
        ...usage.broadcasts.filter((b) => !b.viaDefault).map((b) => `broadcast "${b.name}" (${b.id})`),
        ...steps.map(
          (s) => `step "${s.nodeId}" of journey "${s.journeyName}" (${s.journeyId}, ${s.versionRole.replace('_', '-')} version ${s.version})`,
        ),
      ].slice(0, 3);
      const counts = [
        broadcasts > 0 ? plural(broadcasts, 'broadcast') : null,
        steps.length > 0 ? plural(steps.length, 'journey step') : null,
        usage.queuedJourneyEmails > 0 ? plural(usage.queuedJourneyEmails, 'queued journey email') : null,
      ].filter(Boolean);
      throw new ConflictException(
        `outreach_conflict: email template ${existing.id} is still used by ${counts.join(', ')}${examples.length > 0 ? ` (${examples.join('; ')})` : ''}; point them at another template, or let the queued emails send, before deleting this one`,
      );
    }
    await ctx.db
      .delete(schema.outreachEmailTemplates)
      .where(eq(schema.outreachEmailTemplates.id, existing.id));
    return { deleted: true, id: existing.id };
  }

  async previewTemplate(input: {
    templateId?: string;
    mjml?: string;
    content: EmailContent;
    name?: string | null;
    subject?: string | null;
    preheader?: string | null;
  }): Promise<EmailTemplatePreviewDto> {
    if (input.templateId && input.mjml) {
      throw new OutreachInvalidError('pass either templateId or mjml, not both');
    }
    const template = input.mjml !== undefined ? null : await this.resolveTemplate(input.templateId);
    const rendered = await renderEmail(template?.mjml ?? input.mjml!, input.content, {
      name: input.name ?? null,
      subject: input.subject ?? null,
      preheader: input.preheader ?? null,
      orgName: await this.orgName(),
      unsubscribeUrl: `${stripTrailingSlashes(readApiBaseUrl())}/v1/outreach/unsubscribe?token=preview`,
    });
    return { ...rendered, templateId: template?.id ?? null };
  }

  private async usage(row: TemplateRow): Promise<EmailTemplateUsageDto> {
    const ctx = getCurrentContext();
    const b = schema.outreachBroadcasts;
    const broadcastUse = row.isDefault
      ? or(eq(b.emailTemplateId, row.id), and(isNull(b.emailTemplateId), inArray(b.status, OPEN_BROADCAST_STATUSES)))
      : eq(b.emailTemplateId, row.id);
    const broadcastRows = await ctx.db
      .select({ id: b.id, name: b.name, status: b.status, templateId: b.emailTemplateId })
      .from(b)
      .where(broadcastUse)
      .orderBy(sql`${b.emailTemplateId} is null`, desc(b.createdAt))
      .limit(BROADCAST_LIST_LIMIT);
    const [broadcastTotal] = await ctx.db.select({ n: count() }).from(b).where(broadcastUse);
    const journeySteps = await this.journeyStepUses(row);
    const queued = await this.queuedJourneyEmails(row);
    return {
      broadcasts: broadcastRows.map((r) => ({ id: r.id, name: r.name, status: r.status, viaDefault: r.templateId === null })),
      broadcastTotal: broadcastTotal?.n ?? 0,
      journeySteps,
      queuedJourneyEmails: queued.explicit,
      queuedJourneyEmailsViaDefault: queued.viaDefault,
    };
  }

  private async journeyStepUses(row: TemplateRow): Promise<EmailTemplateJourneyStepUseDto[]> {
    const ctx = getCurrentContext();
    const j = schema.journeys;
    const v = schema.journeyVersions;
    const e = schema.journeyEnrollments;
    const versions = await ctx.db
      .select({
        journeyId: j.id,
        journeyName: j.name,
        liveVersion: j.liveVersion,
        number: v.number,
        publishedAt: v.publishedAt,
        spec: v.spec,
      })
      .from(v)
      .innerJoin(j, eq(j.id, v.journeyId))
      .where(ne(j.status, 'archived'))
      .orderBy(asc(j.name), asc(v.number));
    const running = await ctx.db
      .selectDistinct({ journeyId: e.journeyId, version: e.version })
      .from(e)
      .where(inArray(e.state, RUNNING_ENROLLMENT_STATES));
    const inFlight = new Set(running.map((r) => `${r.journeyId}:${r.version}`));
    const uses: EmailTemplateJourneyStepUseDto[] = [];
    for (const version of versions) {
      const versionRole =
        version.number === version.liveVersion
          ? 'live'
          : !version.publishedAt
            ? 'draft'
            : inFlight.has(`${version.journeyId}:${version.number}`)
              ? 'in_flight'
              : null;
      if (!versionRole) continue;
      const parsed = JourneySpecSchema.safeParse(version.spec);
      if (!parsed.success) continue;
      for (const node of parsed.data.nodes) {
        if (node.type !== 'message' || node.channel !== 'email') continue;
        const templateId = node.content.templateId ?? null;
        if (templateId !== row.id && !(templateId === null && row.isDefault)) continue;
        uses.push({
          journeyId: version.journeyId,
          journeyName: version.journeyName,
          version: version.number,
          versionRole,
          nodeId: node.id,
          viaDefault: templateId === null,
        });
      }
    }
    return uses;
  }

  private async queuedJourneyEmails(row: TemplateRow): Promise<{ explicit: number; viaDefault: number }> {
    const ctx = getCurrentContext();
    const p = schema.outreachProposals;
    const templateId = sql<string | null>`${p.journeyDelivery}->>'templateId'`;
    const [counts] = await ctx.db
      .select({
        explicit: sql<number>`count(*) filter (where ${templateId} = ${row.id})::int`,
        viaDefault: sql<number>`count(*) filter (where ${templateId} is null)::int`,
      })
      .from(p)
      .where(
        and(
          eq(p.kind, 'journey'),
          inArray(p.status, OPEN_PROPOSAL_STATUSES),
          sql`${p.journeyDelivery}->>'channel' = 'email'`,
        ),
      );
    return { explicit: counts?.explicit ?? 0, viaDefault: row.isDefault ? (counts?.viaDefault ?? 0) : 0 };
  }

  private async resolveTemplate(templateId: string | undefined): Promise<TemplateRow> {
    if (templateId) return this.loadTemplate(templateId);
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.outreachEmailTemplates)
      .where(eq(schema.outreachEmailTemplates.isDefault, true))
      .limit(1);
    if (!row) {
      throw new OutreachInvalidError(
        'no default email template; pass templateId or mjml, or mark a template as the default',
      );
    }
    return row;
  }

  private async loadTemplate(id: string): Promise<TemplateRow> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.outreachEmailTemplates)
      .where(eq(schema.outreachEmailTemplates.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`outreach_not_found: email template ${id}`);
    return row;
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const ctx = getCurrentContext();
    const [taken] = await ctx.db
      .select({ id: schema.outreachEmailTemplates.id })
      .from(schema.outreachEmailTemplates)
      .where(
        and(
          eq(schema.outreachEmailTemplates.orgId, ctx.actor!.orgId),
          eq(schema.outreachEmailTemplates.name, name),
          exceptId ? ne(schema.outreachEmailTemplates.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (taken) {
      throw new ConflictException(`outreach_conflict: email template with name "${name}" already exists`);
    }
  }

  private async clearDefault(): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.outreachEmailTemplates)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.outreachEmailTemplates.orgId, ctx.actor!.orgId),
          eq(schema.outreachEmailTemplates.isDefault, true),
        ),
      );
  }

  private async orgName(): Promise<string | null> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, ctx.actor!.orgId))
      .limit(1);
    return row?.name ?? null;
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function toSummaryDto(row: TemplateRow): EmailTemplateSummaryDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDto(row: TemplateRow, warnings: string[], usage: EmailTemplateUsageDto): EmailTemplateDto {
  return { ...toSummaryDto(row), mjml: row.mjml, warnings, usage };
}
