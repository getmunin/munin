import {
  BadRequestException,
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
import type { JourneyValidation } from '../modules/journeys/journey-validator.ts';

const StatusSchema = z.enum(JOURNEY_STATUSES);

@Controller('v1/journeys')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

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
