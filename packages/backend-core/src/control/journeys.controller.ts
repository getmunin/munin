import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
  JOURNEY_STATUSES,
  JourneysService,
  type JourneyDetailDto,
  type JourneyDto,
  type JourneyVersionDto,
  type JourneyVersionSummaryDto,
} from '../modules/journeys/journeys.service.ts';
import {
  ENROLLMENT_STATES,
  JourneyRuntimeService,
  type EnrollmentDto,
  type MoveEnrollmentsResult,
  type TraceDto,
} from '../modules/journeys/journey-runtime.service.ts';
import type { JourneyValidation } from '../modules/journeys/journey-validator.ts';
import {
  JourneyPublishingService,
  type JourneyReportDto,
  type AgentNodeStatsDto,
  type NodeReviewStatsDto,
  type PublishRequestDto,
  type SplitResultDto,
} from '../modules/journeys/journey-publishing.service.ts';
import type { SimulationResult } from '../modules/journeys/journey-simulator.ts';
import { JourneyMonitorService, type GuardrailReportDto } from '../modules/journeys/journey-monitor.service.ts';
import { createZodDto } from 'nestjs-zod';

class MoveEnrollmentsBody extends createZodDto(
  z.object({
    toVersion: z.number().int().min(1),
    nodeMap: z.record(z.string().min(1).max(48), z.string().min(1).max(48)).optional(),
    fromVersions: z.array(z.number().int().min(1)).max(50).optional(),
    fingerprint: z.string().length(32).optional(),
  }),
) {}
class ConfirmPublishBody extends createZodDto(z.object({ fingerprint: z.string().min(1).max(64) })) {}
class SimulateBody extends createZodDto(
  z.object({
    contactIds: z.array(z.string().min(1).max(64)).max(500).optional(),
    segmentId: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    renderSamples: z.number().int().min(0).max(5).optional(),
  }),
) {}

const StatusSchema = z.enum(JOURNEY_STATUSES);

@Controller('v1/journeys')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class JourneysController {
  constructor(
    private readonly journeys: JourneysService,
    private readonly runtime: JourneyRuntimeService,
    private readonly publishing: JourneyPublishingService,
    private readonly monitor: JourneyMonitorService,
  ) {}

  @Get(':id/agent-stats')
  async agentStats(@Param('id') id: string, @Query('days') days?: string): Promise<{ items: AgentNodeStatsDto[] }> {
    const window = days ? Math.min(90, Math.max(1, Number.parseInt(days, 10) || 30)) : 30;
    return { items: await this.publishing.agentStats(id, window) };
  }

  @Get(':id/review-stats')
  async reviewStats(@Param('id') id: string): Promise<{ items: NodeReviewStatsDto[] }> {
    return { items: await this.publishing.nodeReviewStats(id) };
  }

  @Get(':id/report')
  report(@Param('id') id: string, @Query('version') version?: string): Promise<JourneyReportDto> {
    return this.publishing.report(id, version ? Number.parseInt(version, 10) : undefined);
  }

  @Post(':id/versions/:number/simulate')
  @HttpCode(200)
  async simulate(
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: SimulateBody,
  ): Promise<SimulationResult & { version: number }> {
    return this.publishing.simulate({ journeyId: id, version: number, ...body });
  }

  @Post(':id/versions/:number/request-publish')
  @HttpCode(200)
  requestPublish(
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<PublishRequestDto> {
    return this.publishing.requestPublish(id, number);
  }

  @Post(':id/versions/:number/publish')
  @HttpCode(200)
  publish(
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: ConfirmPublishBody,
  ): Promise<JourneyDetailDto> {
    return this.publishing.confirmPublish(id, number, body.fingerprint);
  }

  @Get('enrollments/:enrollmentId/trace')
  trace(@Param('enrollmentId') enrollmentId: string): Promise<TraceDto> {
    return this.runtime.getTrace(enrollmentId);
  }

  @Post('enrollments/:enrollmentId/eject')
  @HttpCode(200)
  eject(@Param('enrollmentId') enrollmentId: string): Promise<EnrollmentDto> {
    return this.runtime.eject(enrollmentId, 'ejected');
  }

  @Get(':id/enrollments')
  async listEnrollments(
    @Param('id') id: string,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: EnrollmentDto[] }> {
    const parsed = state === undefined ? undefined : z.enum(ENROLLMENT_STATES).safeParse(state);
    if (parsed && !parsed.success) {
      throw new BadRequestException(`journeys_invalid: unknown state "${state}"`);
    }
    return {
      items: await this.runtime.listEnrollments({
        journeyId: id,
        state: parsed?.data,
        limit: limit ? Number.parseInt(limit, 10) : undefined,
      }),
    };
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: JourneyDto[] }> {
    const parsedStatus = status === undefined ? undefined : StatusSchema.safeParse(status);
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException(`journeys_invalid: unknown status "${status}"`);
    }
    return {
      items: await this.journeys.list({
        status: parsedStatus?.data,
        limit: limit ? Number.parseInt(limit, 10) : undefined,
      }),
    };
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<JourneyDetailDto> {
    return this.journeys.get(id);
  }

  @Get(':id/versions')
  async listVersions(@Param('id') id: string): Promise<{ items: JourneyVersionSummaryDto[] }> {
    return { items: await this.journeys.listVersions(id) };
  }

  @Get(':id/versions/:number')
  getVersion(
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<JourneyVersionDto> {
    return this.journeys.getVersion(id, number);
  }

  @Post(':id/versions/:number/validate')
  @HttpCode(200)
  validate(
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<JourneyValidation & { version: number }> {
    return this.journeys.validate(id, number);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string): Promise<JourneyDto> {
    return this.journeys.pause(id);
  }

  @Post(':id/move-enrollments')
  @HttpCode(200)
  moveEnrollments(@Param('id') id: string, @Body() body: MoveEnrollmentsBody): Promise<MoveEnrollmentsResult> {
    return this.runtime.moveEnrollments({ journeyId: id, ...body });
  }

  @Get(':id/split-results')
  async splitResults(@Param('id') id: string): Promise<{ items: SplitResultDto[] }> {
    return { items: await this.publishing.splitResults(id) };
  }

  @Get(':id/guardrails')
  guardrails(@Param('id') id: string): Promise<GuardrailReportDto> {
    return this.monitor.report(id);
  }

  @Post(':id/nodes/:nodeId/pause')
  @HttpCode(200)
  pauseNode(@Param('id') id: string, @Param('nodeId') nodeId: string): Promise<JourneyDto> {
    return this.journeys.pauseNode(id, nodeId);
  }

  @Post(':id/nodes/:nodeId/resume')
  @HttpCode(200)
  resumeNode(@Param('id') id: string, @Param('nodeId') nodeId: string): Promise<JourneyDto & { released: number }> {
    return this.journeys.resumeNode(id, nodeId);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id') id: string): Promise<JourneyDto> {
    return this.journeys.resume(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string): Promise<JourneyDto> {
    return this.journeys.archive(id);
  }
}
