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
import { KbService, type KbExportData } from '../modules/kb/kb.service.ts';
import { IdMapSchema, type ImportResult } from '../common/transfer/transfer.types.ts';

const ImportBody = z.object({
  records: z.object({
    spaces: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
        slug: z.string().min(1).max(64),
        description: z.string().nullable().optional(),
      }),
    ),
    documents: z.array(
      z.object({
        id: z.string(),
        spaceId: z.string(),
        slug: z.string().nullable().optional(),
        title: z.string().min(1).max(300),
        body: z.string().min(1),
        audiences: z.array(z.enum(['admin', 'self_service'])).min(1),
        tags: z.array(z.string()),
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Controller('v1/kb')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class KbTransferController {
  constructor(private readonly kb: KbService) {}

  @Get('export')
  export(): Promise<KbExportData> {
    return this.kb.exportKb();
  }

  @Post('import')
  @HttpCode(200)
  async import(@Body() body: unknown): Promise<ImportResult> {
    const parsed = ImportBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const records = {
      spaces: parsed.data.records.spaces.map((s) => ({ ...s, description: s.description ?? null })),
      documents: parsed.data.records.documents.map((d) => ({ ...d, slug: d.slug ?? null })),
    };
    return this.kb.importKb(records, parsed.data.idMap);
  }
}
