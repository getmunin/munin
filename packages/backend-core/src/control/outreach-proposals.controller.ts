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
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  OutreachInvalidError,
  OutreachService,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  type ProposalDto,
} from '../modules/outreach/outreach.service.ts';

const StatusSchema = z.enum(PROPOSAL_STATUSES);
const KindSchema = z.enum(PROPOSAL_KINDS);
const DismissBody = z.object({ reason: z.string().max(500).optional() });
const UpdateBody = z.object({
  draftSubject: z.string().max(500).nullable().optional(),
  draftBody: z.string().min(1).optional(),
});

interface ProposalListResponse {
  items: ProposalDto[];
}

@Controller('v1/outreach/proposals')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OutreachProposalsController {
  constructor(private readonly outreach: OutreachService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('campaignId') campaignId?: string,
    @Query('contactId') contactId?: string,
    @Query('limit') limit?: string,
  ): Promise<ProposalListResponse> {
    const parsedStatus = status ? StatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException(`invalid status: ${status}`);
    }
    const parsedKind = kind ? KindSchema.safeParse(kind) : null;
    if (parsedKind && !parsedKind.success) {
      throw new BadRequestException(`invalid kind: ${kind}`);
    }
    const items = await translate(() =>
      this.outreach.listProposals({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        kind: parsedKind?.success ? parsedKind.data : undefined,
        campaignId,
        contactId,
        limit: parseLimit(limit),
      }),
    );
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ProposalDto> {
    return translate(() => this.outreach.getProposal(id));
  }

  @Patch(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: unknown): Promise<ProposalDto> {
    const parsed = UpdateBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() =>
      this.outreach.updateProposal({
        id,
        draftSubject: parsed.data.draftSubject,
        draftBody: parsed.data.draftBody,
      }),
    );
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string): Promise<ProposalDto> {
    const publicBaseUrl = process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001';
    return translate(() => this.outreach.approveProposal(id, { publicBaseUrl }));
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@Param('id') id: string, @Body() body: unknown): Promise<ProposalDto> {
    const parsed = DismissBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() => this.outreach.dismissProposal({ id, reason: parsed.data.reason }));
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OutreachInvalidError) throw new BadRequestException(err.message);
    throw err;
  }
}

function parseLimit(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 500);
}
