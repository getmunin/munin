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
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  AnalyticsService,
  type AnalyticsConfigExport,
  type AnalyticsEventsExport,
} from '../modules/analytics/analytics.service.ts';
import {
  CursorInputSchema,
  IdMapSchema,
  type ExportPage,
  type ImportResult,
} from '../common/transfer/transfer.types.ts';

const ImportBody = z.object({
  config: z
    .object({
      trackers: z.array(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(120),
          allowedOrigins: z.array(z.string()).default([]),
          requireVerifiedIdentity: z.boolean().default(false),
          identityVerificationSecret: z.string().nullable().optional(),
        }),
      ),
      visitorIdentities: z.array(
        z.object({
          id: z.string(),
          visitorId: z.string().min(1).max(64),
          endUserId: z.string(),
        }),
      ),
    })
    .optional(),
  events: z
    .object({
      viewEvents: z.array(
        z.object({
          id: z.string(),
          subjectType: z.string().max(32),
          subjectId: z.string(),
          source: z.string().max(8),
          path: z.string().nullable().optional(),
          locale: z.string().nullable().optional(),
          referrer: z.string().nullable().optional(),
          utmSource: z.string().nullable().optional(),
          utmMedium: z.string().nullable().optional(),
          utmCampaign: z.string().nullable().optional(),
          visitorId: z.string().nullable().optional(),
          endUserId: z.string().nullable().optional(),
          userAgentClass: z.string().nullable().optional(),
          dwellMs: z.number().int().nullable().optional(),
          readDepth: z.number().int().nullable().optional(),
          country: z.string().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()).nullable().optional(),
          createdAt: z.string(),
        }),
      ),
      searchEvents: z.array(
        z.object({
          id: z.string(),
          subjectType: z.string().max(32),
          query: z.string(),
          locale: z.string().nullable().optional(),
          resultCount: z.number().int(),
          visitorId: z.string().nullable().optional(),
          endUserId: z.string().nullable().optional(),
          createdAt: z.string(),
        }),
      ),
    })
    .optional(),
  idMap: IdMapSchema.optional(),
});

const ExportEventsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

@Controller('v1/analytics')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class AnalyticsTransferController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('export/config')
  exportConfig(): Promise<AnalyticsConfigExport> {
    return this.analytics.exportAnalyticsConfig();
  }

  @Get('export/events')
  exportEvents(@Query() query: unknown): Promise<ExportPage<AnalyticsEventsExport>> {
    const parsed = ExportEventsQuery.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.analytics.exportAnalyticsEvents(
      CursorInputSchema.parse(parsed.data),
    );
  }

  @Post('import')
  @HttpCode(200)
  async import(@Body() body: unknown): Promise<ImportResult> {
    const parsed = ImportBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.analytics.importAnalytics(
      { config: parsed.data.config, events: parsed.data.events },
      parsed.data.idMap,
    );
  }
}
