import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { CmsService, type CmsExportData } from '../modules/cms/cms.service.ts';
import {
  CmsExportInput,
  CmsImportBody,
  toCmsExportData,
} from '../modules/cms/cms.schemas.ts';
import type { ImportResult } from '../common/transfer/transfer.types.ts';

class ImportCmsBody extends createZodDto(CmsImportBody) {}

const ExportCmsQuery = z.object({
  collections: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v])
            .flatMap((s) => s.split(','))
            .map((s) => s.trim())
            .filter(Boolean),
    ),
  includeAssetBytes: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

@Controller('v1/cms/transfer')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CmsTransferController {
  constructor(private readonly cms: CmsService) {}

  @Get('export')
  export(@Query() query: unknown): Promise<CmsExportData> {
    const raw = ExportCmsQuery.safeParse(query ?? {});
    const parsed = raw.success ? CmsExportInput.safeParse(raw.data) : raw;
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.cms.exportCms(parsed.data);
  }

  @Post('import')
  @HttpCode(200)
  import(@Body() input: ImportCmsBody): Promise<ImportResult> {
    return this.cms.importCms(toCmsExportData(input.records), input.idMap);
  }
}
