import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { JourneysService, type JourneyDetailDto } from './journeys.service.ts';
import type { JourneyValidation } from './journey-validator.ts';
import {
  BUILT_IN_TEMPLATES,
  fillTemplate,
  missingParams,
  type JourneyTemplate,
  type TemplateParam,
} from './journey-templates.ts';

export type JourneyTemplateSummaryDto = Omit<JourneyTemplate, 'spec'>;

@Injectable()
export class JourneyTemplatesService {
  constructor(@Inject(JourneysService) private readonly journeys: JourneysService) {}

  async list(locale?: string): Promise<JourneyTemplateSummaryDto[]> {
    const all = [...BUILT_IN_TEMPLATES, ...(await this.orgTemplates())];
    return all
      .filter((t) => !locale || t.locale === locale)
      .map(({ spec: _spec, ...rest }) => rest);
  }

  async get(slug: string, locale: string): Promise<JourneyTemplate> {
    const own = (await this.orgTemplates()).find((t) => t.slug === slug && t.locale === locale);
    const template = own ?? BUILT_IN_TEMPLATES.find((t) => t.slug === slug && t.locale === locale);
    if (!template) throw new NotFoundException(`journeys_not_found: template ${slug} (${locale})`);
    return template;
  }

  async instantiate(input: {
    slug: string;
    locale: string;
    name: string;
    outreachCampaignId: string;
    params: Record<string, string>;
  }): Promise<JourneyDetailDto & { validation: JourneyValidation }> {
    const template = await this.get(input.slug, input.locale);
    const missing = template.params.filter((p) => p.required && !input.params[p.key]).map((p) => p.key);
    if (missing.length) {
      throw new BadRequestException(`journeys_invalid: template ${input.slug} needs params ${missing.join(', ')}`);
    }
    const spec = fillTemplate(template.spec, input.params) as Record<string, unknown>;
    const left = missingParams(spec);
    if (left.length) {
      throw new BadRequestException(`journeys_invalid: template ${input.slug} still has unfilled params ${left.join(', ')}`);
    }
    const journey = await this.journeys.create({
      name: input.name,
      description: template.description,
      outreachCampaignId: input.outreachCampaignId,
      spec,
    });
    const validation = await this.journeys.validate(journey.id);
    return { ...(await this.journeys.get(journey.id)), validation };
  }

  async saveAsTemplate(input: {
    journeyId: string;
    version?: number;
    slug: string;
    locale: string;
    title: string;
    description: string;
    tags?: string[];
    params?: TemplateParam[];
    replace?: Record<string, string>;
  }): Promise<JourneyTemplateSummaryDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (BUILT_IN_TEMPLATES.some((t) => t.slug === input.slug)) {
      throw new ConflictException(`journeys_conflict: "${input.slug}" is a built-in template slug; choose another`);
    }
    const journey = await this.journeys.get(input.journeyId);
    const version = input.version
      ? await this.journeys.getVersion(input.journeyId, input.version)
      : (journey.live ?? journey.draft);
    if (!version) throw new NotFoundException(`journeys_not_found: journey ${input.journeyId} has no version`);
    let specText = JSON.stringify(version.spec);
    for (const [value, key] of Object.entries(input.replace ?? {})) {
      specText = specText.split(JSON.stringify(value).slice(1, -1)).join(`{{param:${key}}}`);
    }
    const spec = JSON.parse(specText) as Record<string, unknown>;
    const declared = new Set((input.params ?? []).map((p) => p.key));
    const undeclared = missingParams(spec).filter((k) => !declared.has(k));
    if (undeclared.length) {
      throw new BadRequestException(`journeys_invalid: declare params ${undeclared.join(', ')} used in the spec`);
    }
    const t = schema.journeyTemplates;
    const [row] = await ctx.db
      .insert(t)
      .values({
        orgId: actor.orgId,
        slug: input.slug,
        locale: input.locale,
        title: input.title,
        description: input.description,
        tags: input.tags ?? [],
        params: input.params ?? [],
        spec,
        createdByActorType: actor.type,
        createdByActorId: actor.id,
      })
      .onConflictDoUpdate({
        target: [t.orgId, t.slug, t.locale],
        set: {
          title: input.title,
          description: input.description,
          tags: input.tags ?? [],
          params: input.params ?? [],
          spec,
          updatedAt: new Date(),
        },
      })
      .returning();
    const { spec: _spec, ...summary } = toTemplate(row!);
    return summary;
  }

  private async orgTemplates(): Promise<JourneyTemplate[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.journeyTemplates)
      .where(and(eq(schema.journeyTemplates.orgId, ctx.actor!.orgId)))
      .orderBy(asc(schema.journeyTemplates.slug));
    return rows.map(toTemplate);
  }
}

function toTemplate(row: typeof schema.journeyTemplates.$inferSelect): JourneyTemplate {
  return {
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    description: row.description,
    tags: row.tags,
    params: row.params,
    spec: row.spec,
    builtIn: false,
  };
}
