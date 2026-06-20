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
  ConvService,
  CHANNEL_TYPES,
  STATUSES,
  AGENT_MODES,
  type ConvExportData,
} from '../modules/conv/conv.service.ts';
import { IdMapSchema, type ImportResult } from '../common/transfer/transfer.types.ts';

const ImportBody = z.object({
  records: z.object({
    channels: z.array(
      z.object({
        id: z.string(),
        type: z.enum(CHANNEL_TYPES),
        vendor: z.string().min(1).max(32),
        name: z.string().min(1).max(120),
        active: z.boolean(),
      }),
    ),
    conversations: z.array(
      z.object({
        id: z.string(),
        channelId: z.string(),
        subject: z.string().nullable(),
        status: z.enum(STATUSES),
        topicSlug: z.string().nullable(),
        agentMode: z.enum(AGENT_MODES),
      }),
    ),
    messages: z.array(
      z.object({
        id: z.string(),
        conversationId: z.string(),
        authorType: z.enum(['user', 'agent', 'end_user', 'system']),
        authorId: z.string(),
        body: z.string(),
        internal: z.boolean(),
        inReplyToId: z.string().nullable(),
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Controller('v1/conv')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class ConvTransferController {
  constructor(private readonly conv: ConvService) {}

  @Get('export')
  export(): Promise<ConvExportData> {
    return this.conv.exportConv();
  }

  @Post('import')
  @HttpCode(200)
  async import(@Body() body: unknown): Promise<ImportResult> {
    const parsed = ImportBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.conv.importConv(parsed.data.records, parsed.data.idMap);
  }
}
