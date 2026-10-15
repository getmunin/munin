import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, readApiBaseUrl } from '@getmunin/core';
import { stripTrailingSlashes } from '@getmunin/types';
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

export interface EmailTemplateDto extends EmailTemplateSummaryDto {
  mjml: string;
  warnings: string[];
}

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
    return toDto(row, warnings);
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
    return toDto(row!, warnings);
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
    return toDto(row!, warnings);
  }

  async deleteTemplate(id: string): Promise<{ deleted: true; id: string }> {
    const ctx = getCurrentContext();
    const existing = await this.loadTemplate(id);
    const [used] = await ctx.db
      .select({ id: schema.outreachBroadcasts.id, name: schema.outreachBroadcasts.name })
      .from(schema.outreachBroadcasts)
      .where(eq(schema.outreachBroadcasts.emailTemplateId, existing.id))
      .limit(1);
    if (used) {
      throw new ConflictException(
        `outreach_conflict: email template ${existing.id} is used by broadcast "${used.name}" (${used.id}); point that broadcast at another template before deleting this one`,
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

function toDto(row: TemplateRow, warnings: string[]): EmailTemplateDto {
  return { ...toSummaryDto(row), mjml: row.mjml, warnings };
}
