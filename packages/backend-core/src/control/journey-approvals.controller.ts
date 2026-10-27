import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { JourneyRuntimeService } from '../modules/journeys/journey-runtime.service.ts';

class DecideApprovalBody extends createZodDto(
  z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(2000).optional() }),
) {}

@Controller('v1/journey-approvals')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class JourneyApprovalsController {
  constructor(private readonly runtime: JourneyRuntimeService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('journeyId') journeyId?: string,
  ): Promise<{ items: Awaited<ReturnType<JourneyRuntimeService['listApprovals']>> }> {
    return { items: await this.runtime.listApprovals({ status, journeyId }) };
  }

  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id') id: string, @Body() body: DecideApprovalBody): Promise<{ id: string; status: string }> {
    return this.runtime.decideApproval({ approvalId: id, decision: body.decision, note: body.note });
  }
}
