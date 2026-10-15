import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { OutreachInvalidError } from '../modules/outreach/outreach.service.ts';
import { EMAIL_CONTENT_FORMATS } from '../modules/outreach/email-template-render.ts';
import {
  BROADCAST_RECIPIENT_STATUSES,
  BROADCAST_STATUSES,
  OutreachBroadcastsService,
  type BroadcastDto,
  type BroadcastRecipientDto,
  type BroadcastSummaryDto,
} from '../modules/outreach/outreach-broadcasts.service.ts';

const SendAt = z.string().datetime({ offset: true }).nullable();

const BroadcastFields = z.object({
  name: z.string().min(1).max(120),
  segmentId: z.string().min(1).max(64),
  channelId: z.string().min(1).max(64),
  emailTemplateId: z.string().min(1).max(64).nullable().optional(),
  subject: z.string().min(1).max(300),
  preheader: z.string().max(300).nullable().optional(),
  content: z.object({
    format: z.enum(EMAIL_CONTENT_FORMATS),
    body: z.string().min(1).max(100_000),
  }),
  scheduledSendAt: SendAt.optional(),
  maxPerHour: z.number().int().min(1).max(100_000).nullable().optional(),
});

class CreateBroadcastBody extends createZodDto(BroadcastFields) {}
class UpdateBroadcastBody extends createZodDto(BroadcastFields.partial()) {}
class ApproveBroadcastBody extends createZodDto(
  z.object({ fingerprint: z.string().min(1).max(64), sendAt: SendAt.optional() }),
) {}
class DismissBroadcastBody extends createZodDto(z.object({ reason: z.string().max(500).optional() })) {}
class CancelBroadcastBody extends createZodDto(z.object({ reason: z.string().min(1).max(500) })) {}
class TestBroadcastBody extends createZodDto(z.object({ to: z.string().email().max(320).optional() })) {}

const StatusSchema = z.enum(BROADCAST_STATUSES);
const RecipientStatusSchema = z.enum(BROADCAST_RECIPIENT_STATUSES);

@Controller('v1/outreach/broadcasts')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OutreachBroadcastsController {
  constructor(private readonly broadcasts: OutreachBroadcastsService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: BroadcastSummaryDto[] }> {
    const parsed = status ? StatusSchema.safeParse(status) : null;
    if (parsed && !parsed.success) throw new BadRequestException(`invalid status: ${status}`);
    const items = await this.broadcasts.listBroadcasts({
      status: parsed?.success ? parsed.data : undefined,
      limit: parseLimit(limit),
    });
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<BroadcastDto> {
    return translate(() => this.broadcasts.getBroadcast(id));
  }

  @Get(':id/recipients')
  async recipients(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('after') after?: string,
  ): Promise<{ items: BroadcastRecipientDto[]; nextCursor: string | null }> {
    const parsed = status ? RecipientStatusSchema.safeParse(status) : null;
    if (parsed && !parsed.success) throw new BadRequestException(`invalid status: ${status}`);
    return translate(() =>
      this.broadcasts.listRecipients({
        broadcastId: id,
        status: parsed?.success ? parsed.data : undefined,
        limit: parseLimit(limit),
        after,
      }),
    );
  }

  @Post()
  async create(@Body() input: CreateBroadcastBody): Promise<BroadcastDto> {
    return translate(() => this.broadcasts.createBroadcast(input));
  }

  @Patch(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() input: UpdateBroadcastBody): Promise<BroadcastDto> {
    return translate(() => this.broadcasts.updateBroadcast({ id, ...input }));
  }

  @Post(':id/test')
  @HttpCode(200)
  async test(
    @Param('id') id: string,
    @Body() input: TestBroadcastBody,
  ): Promise<{ sent: true; to: string; messageId: string }> {
    return translate(() => this.broadcasts.sendBroadcastTest({ id, to: input.to }));
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() input: ApproveBroadcastBody): Promise<BroadcastDto> {
    return translate(() =>
      this.broadcasts.approveBroadcast({ id, fingerprint: input.fingerprint, sendAt: input.sendAt }),
    );
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@Param('id') id: string, @Body() input: DismissBroadcastBody): Promise<BroadcastDto> {
    return translate(() => this.broadcasts.dismissBroadcast({ id, reason: input.reason }));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() input: CancelBroadcastBody): Promise<BroadcastDto> {
    return translate(() => this.broadcasts.cancelBroadcast({ id, reason: input.reason }));
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OutreachInvalidError) {
      if (err.code !== 'outreach_invalid') {
        throw new BadRequestException({ message: err.message, code: err.code });
      }
      throw new BadRequestException(err.message);
    }
    throw err;
  }
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
