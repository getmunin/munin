import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import {
  CuratorJobsService,
  CURATOR_JOB_STATUSES,
  type CuratorJobDto,
} from '../modules/curator/curator-jobs.service.ts';

const StatusSchema = z.enum(CURATOR_JOB_STATUSES);

class EnqueueJobBody extends createZodDto(
  z.object({
    jobUri: z.string().min(1),
    userPrompt: z.string().min(1),
    sourceEventType: z.string().optional(),
    sourceEventPayload: z.unknown().optional(),
    dedupeKey: z.string().min(1).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    delaySeconds: z.number().int().min(0).max(86400).optional(),
  }),
) {}

class ClaimJobBody extends createZodDto(
  z.object({
    holder: z.string().min(1).max(128),
    limit: z.number().int().min(1).max(25).optional(),
    leaseSeconds: z.number().int().min(30).max(3600).optional(),
  }),
) {}

class AckJobBody extends createZodDto(
  z.object({
    replyText: z.string().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  }),
) {}

class FailJobBody extends createZodDto(
  z.object({
    error: z.string().min(1).max(4000),
    retryable: z.boolean().optional(),
    code: z.string().min(1).max(64).optional(),
    failedStep: z.string().min(1).max(64).optional(),
  }),
) {}

interface JobListResponse {
  items: CuratorJobDto[];
}

interface ClaimResponse {
  items: CuratorJobDto[];
}

@Controller('v1/curation/jobs')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CuratorJobsController {
  constructor(private readonly service: CuratorJobsService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<JobListResponse> {
    let parsedStatus: z.infer<typeof StatusSchema> | undefined;
    if (status) {
      const result = StatusSchema.safeParse(status);
      if (!result.success) throw new BadRequestException(`invalid status: ${status}`);
      parsedStatus = result.data;
    }
    const items = await this.service.list({
      status: parsedStatus,
      limit: parseLimit(limit),
    });
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<CuratorJobDto> {
    return this.service.get(id);
  }

  @Post()
  @HttpCode(201)
  async enqueue(
    @Body() input: EnqueueJobBody,
  ): Promise<{ job: CuratorJobDto; alreadyPending: boolean }> {
    return this.service.enqueue(input);
  }

  @Post('claim')
  @HttpCode(200)
  async claim(@Body() input: ClaimJobBody): Promise<ClaimResponse> {
    const items = await this.service.claim(input);
    return { items };
  }

  @Post(':id/ack')
  @HttpCode(200)
  async ack(@Param('id') id: string, @Body() input: AckJobBody): Promise<CuratorJobDto> {
    return this.service.ack({ id, ...input });
  }

  @Post(':id/fail')
  @HttpCode(200)
  async fail(@Param('id') id: string, @Body() input: FailJobBody): Promise<CuratorJobDto> {
    return this.service.fail({ id, ...input });
  }
}

function parseLimit(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 200);
}
