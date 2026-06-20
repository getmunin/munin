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
import { CmsService, type CmsExportData } from '../modules/cms/cms.service.ts';
import { IdMapSchema, type ImportResult } from '../common/transfer/transfer.types.ts';

const ImportBody = z.object({
  records: z.object({
    locales: z.array(
      z.object({
        id: z.string(),
        code: z.string().min(2).max(16),
        name: z.string().min(1).max(120),
        isDefault: z.boolean(),
      }),
    ),
    collections: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
        slug: z.string().min(1).max(64),
        description: z.string().nullable().optional(),
        fields: z.array(z.unknown()),
        localized: z.boolean(),
        settings: z.record(z.string(), z.unknown()),
      }),
    ),
    entries: z.array(
      z.object({
        id: z.string(),
        collectionId: z.string(),
        slug: z.string().min(1).max(200),
        locale: z.string().min(1).max(16),
        status: z.enum(['draft', 'published', 'scheduled', 'archived']),
        data: z.record(z.string(), z.unknown()),
        scheduledAt: z.string().nullable().optional(),
      }),
    ),
    assets: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255),
        mime: z.string().min(1).max(120),
        sizeBytes: z.number().int().nonnegative(),
        storageKey: z.string(),
        altText: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()),
        base64Body: z.string().nullable().optional(),
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Controller('v1/cms/transfer')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CmsTransferController {
  constructor(private readonly cms: CmsService) {}

  @Get('export')
  export(): Promise<CmsExportData> {
    return this.cms.exportCms();
  }

  @Post('import')
  @HttpCode(200)
  async import(@Body() body: unknown): Promise<ImportResult> {
    const parsed = ImportBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const records: CmsExportData = {
      locales: parsed.data.records.locales,
      collections: parsed.data.records.collections.map((c) => ({
        ...c,
        description: c.description ?? null,
        fields: c.fields as CmsExportData['collections'][number]['fields'],
      })),
      entries: parsed.data.records.entries.map((e) => ({
        ...e,
        scheduledAt: e.scheduledAt ?? null,
      })),
      assets: parsed.data.records.assets.map((a) => ({
        ...a,
        altText: a.altText ?? null,
        base64Body: a.base64Body ?? null,
      })),
    };
    return this.cms.importCms(records, parsed.data.idMap);
  }
}
