import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../../common/audit/audit.interceptor.ts';
import {
  ALERT_SOURCES,
  AlertNotFoundError,
  AlertsService,
  type AlertDto,
  type AlertSource,
} from './system-alerts.service.ts';

@Controller('v1/system/alerts')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class SystemAlertsController {
  constructor(private readonly service: AlertsService) {}

  @Get()
  async list(
    @Query('includeResolved') includeResolved?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
  ): Promise<{ items: AlertDto[] }> {
    const parsedLimit = parseLimit(limit);
    const parsedSource = parseSource(source);
    return {
      items: await this.service.list({
        includeResolved: includeResolved === 'true',
        limit: parsedLimit,
        source: parsedSource,
      }),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<AlertDto> {
    try {
      return await this.service.get(id);
    } catch (err) {
      if (err instanceof AlertNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id') id: string): Promise<AlertDto> {
    try {
      return await this.service.acknowledgeAlert(id);
    } catch (err) {
      if (err instanceof AlertNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new BadRequestException('limit must be an integer between 1 and 200');
  }
  return parsed;
}

function parseSource(raw: string | undefined): AlertSource | undefined {
  if (!raw) return undefined;
  if (!(ALERT_SOURCES as readonly string[]).includes(raw)) {
    throw new BadRequestException(`source must be one of: ${ALERT_SOURCES.join(', ')}`);
  }
  return raw as AlertSource;
}
