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
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  CrmService,
  CrmInvalidError,
  MERGE_STATUSES,
  type MergeProposalDto,
} from '../modules/crm/crm.service.ts';

const StatusSchema = z.enum(MERGE_STATUSES);

const DismissBody = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .partial();

interface MergeProposalListResponse {
  items: MergeProposalDto[];
}

@Controller('v1/crm/merge-proposals')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CrmMergeProposalsController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<MergeProposalListResponse> {
    const parsedStatus = status ? StatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException(`invalid status: ${status}`);
    }
    const items = await translate(() =>
      this.crm.listMergeProposals({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        limit: parseLimit(limit),
      }),
    );
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<MergeProposalDto> {
    return translate(() => this.crm.getMergeProposal(id));
  }

  @Post(':id/apply')
  @HttpCode(200)
  async apply(@Param('id') id: string): Promise<MergeProposalDto> {
    return translate(() => this.crm.applyMergeProposal({ id }));
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MergeProposalDto> {
    const parsed = DismissBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() => this.crm.dismissMergeProposal({ id, reason: parsed.data.reason }));
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CrmInvalidError) throw new BadRequestException(err.message);
    throw err;
  }
}

function parseLimit(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 200);
}
