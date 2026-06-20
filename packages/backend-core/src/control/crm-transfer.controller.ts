import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  CrmService,
  type CrmExportData,
  ACTIVITY_TYPES,
  RELATIONSHIP_TYPES,
} from '../modules/crm/crm.service.ts';
import { IdMapSchema, type ImportResult } from '../common/transfer/transfer.types.ts';

const SegmentFilterSchema = z.object({
  tagsAny: z.array(z.string().min(1).max(64)).max(32).optional(),
  tagsAll: z.array(z.string().min(1).max(64)).max(32).optional(),
  companyId: z.string().min(1).max(64).optional(),
  searchQuery: z.string().min(1).max(200).optional(),
  contactedSince: z.string().optional(),
});

const TagsSchema = z.array(z.string().min(1).max(64)).max(32);
const CustomFieldsSchema = z.record(z.string(), z.unknown());

const ImportBody = z.object({
  records: z.object({
    pipelines: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
        slug: z.string().min(1).max(64),
        stages: z.array(
          z.object({
            id: z.string(),
            name: z.string().min(1).max(120),
            position: z.number().int().nonnegative(),
            winLoss: z.enum(['open', 'won', 'lost']),
          }),
        ),
      }),
    ),
    segments: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
        description: z.string().nullable().optional(),
        filterDefinition: SegmentFilterSchema,
      }),
    ),
    companies: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200),
        domain: z.string().max(200).nullable().optional(),
        tags: TagsSchema,
        customFields: CustomFieldsSchema,
      }),
    ),
    contacts: z.array(
      z.object({
        id: z.string(),
        companyId: z.string().nullable().optional(),
        name: z.string().max(200).nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
        title: z.string().max(120).nullable().optional(),
        address: z.string().max(500).nullable().optional(),
        tags: TagsSchema,
        customFields: CustomFieldsSchema,
      }),
    ),
    deals: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200),
        pipelineId: z.string(),
        stageId: z.string(),
        amountCents: z.number().int().nullable().optional(),
        currency: z.string().max(8).nullable().optional(),
        primaryContactId: z.string().nullable().optional(),
        companyId: z.string().nullable().optional(),
        expectedCloseAt: z.string().nullable().optional(),
      }),
    ),
    activities: z.array(
      z.object({
        id: z.string(),
        type: z.enum(ACTIVITY_TYPES),
        subject: z.string().nullable().optional(),
        body: z.string().nullable().optional(),
        contactId: z.string().nullable().optional(),
        companyId: z.string().nullable().optional(),
        dealId: z.string().nullable().optional(),
        dueAt: z.string().nullable().optional(),
        completedAt: z.string().nullable().optional(),
        metadata: CustomFieldsSchema,
      }),
    ),
    relationships: z.array(
      z.object({
        id: z.string(),
        fromType: z.enum(RELATIONSHIP_TYPES),
        fromId: z.string(),
        toType: z.enum(RELATIONSHIP_TYPES),
        toId: z.string(),
        role: z.string().min(1).max(64),
        startedAt: z.string().nullable().optional(),
        endedAt: z.string().nullable().optional(),
        metadata: CustomFieldsSchema,
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Controller('v1/crm')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CrmTransferController {
  constructor(private readonly crm: CrmService) {}

  @Get('export')
  export(): Promise<CrmExportData> {
    return this.crm.exportCrm();
  }

  @Post('import')
  @HttpCode(200)
  async import(@Body() body: unknown): Promise<ImportResult> {
    const parsed = ImportBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const r = parsed.data.records;
    const records: CrmExportData = {
      pipelines: r.pipelines,
      segments: r.segments.map((s) => ({ ...s, description: s.description ?? null })),
      companies: r.companies.map((c) => ({ ...c, domain: c.domain ?? null })),
      contacts: r.contacts.map((c) => ({
        ...c,
        companyId: c.companyId ?? null,
        name: c.name ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        title: c.title ?? null,
        address: c.address ?? null,
      })),
      deals: r.deals.map((d) => ({
        ...d,
        amountCents: d.amountCents ?? null,
        currency: d.currency ?? null,
        primaryContactId: d.primaryContactId ?? null,
        companyId: d.companyId ?? null,
        expectedCloseAt: d.expectedCloseAt ?? null,
      })),
      activities: r.activities.map((a) => ({
        ...a,
        subject: a.subject ?? null,
        body: a.body ?? null,
        contactId: a.contactId ?? null,
        companyId: a.companyId ?? null,
        dealId: a.dealId ?? null,
        dueAt: a.dueAt ?? null,
        completedAt: a.completedAt ?? null,
      })),
      relationships: r.relationships.map((rel) => ({
        ...rel,
        startedAt: rel.startedAt ?? null,
        endedAt: rel.endedAt ?? null,
      })),
    };
    return this.crm.importCrm(records, parsed.data.idMap);
  }
}
