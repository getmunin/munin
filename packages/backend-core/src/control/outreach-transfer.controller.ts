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
  OutreachService,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  type OutreachExportData,
} from '../modules/outreach/outreach.service.ts';
import { IdMapSchema, type ImportResult } from '../common/transfer/transfer.types.ts';

const ImportBody = z.object({
  records: z.object({
    campaigns: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
        brief: z.string().min(1).max(5000),
        segmentId: z.string(),
        channelId: z.string(),
        cadenceRules: z
          .object({
            maxPerWeekPerContact: z.number().int().positive().max(7).optional(),
            quietHoursStart: z.string().optional(),
            quietHoursEnd: z.string().optional(),
            blackoutDates: z.array(z.string()).optional(),
          })
          .default({}),
        ctaUrl: z.string().nullable().optional(),
        autoDraftInitial: z.boolean().default(false),
        autoDraftReplies: z.boolean().default(true),
        unsubscribeRequired: z.boolean(),
      }),
    ),
    proposals: z.array(
      z.object({
        id: z.string(),
        campaignId: z.string(),
        contactId: z.string(),
        conversationId: z.string().nullable().optional(),
        kind: z.enum(PROPOSAL_KINDS),
        draftSubject: z.string().nullable().optional(),
        draftBody: z.string().min(1),
        evidence: z.record(z.string(), z.unknown()).default({}),
        proposedSendAt: z.string().nullable().optional(),
        status: z.enum(PROPOSAL_STATUSES),
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Controller('v1/outreach')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OutreachTransferController {
  constructor(private readonly outreach: OutreachService) {}

  @Get('export')
  export(): Promise<OutreachExportData> {
    return this.outreach.exportOutreach();
  }

  @Post('import')
  @HttpCode(200)
  async import(@Body() body: unknown): Promise<ImportResult> {
    const parsed = ImportBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const records = {
      campaigns: parsed.data.records.campaigns.map((c) => ({ ...c, ctaUrl: c.ctaUrl ?? null })),
      proposals: parsed.data.records.proposals.map((p) => ({
        ...p,
        conversationId: p.conversationId ?? null,
        draftSubject: p.draftSubject ?? null,
        proposedSendAt: p.proposedSendAt ?? null,
      })),
    };
    return this.outreach.importOutreach(records, parsed.data.idMap);
  }
}
