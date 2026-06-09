import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CreateTrackerBody, UpdateTrackerBody } from '@getmunin/types';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import { AnalyticsAdminTools } from '../modules/analytics/analytics.tools.ts';

@Controller('v1/analytics/trackers')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class AnalyticsTrackersController {
  constructor(private readonly tools: AnalyticsAdminTools) {}

  @Get()
  async list(): Promise<{
    items: Awaited<ReturnType<AnalyticsAdminTools['listTrackers']>>;
  }> {
    const items = await this.tools.listTrackers({ includeRevoked: false });
    return { items };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<AnalyticsAdminTools['createTracker']>>> {
    const parsed = CreateTrackerBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.tools.createTracker(parsed.data);
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<AnalyticsAdminTools['updateTracker']>>> {
    const parsed = UpdateTrackerBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.tools.updateTracker({ trackerId: id, ...parsed.data });
  }

  @Post(':id/rotate-identity-secret')
  @HttpCode(200)
  async rotateIdentitySecret(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<AnalyticsAdminTools['rotateIdentitySecret']>>> {
    return this.tools.rotateIdentitySecret({ trackerId: id });
  }

  @Post(':id/revoke')
  @HttpCode(200)
  async revoke(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<AnalyticsAdminTools['revokeTracker']>>> {
    return this.tools.revokeTracker({ trackerId: id });
  }
}
