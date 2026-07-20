import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  SlackService,
  type SlackRouteDto,
  type SlackStatusDto,
} from '../modules/slack/slack.service.ts';

const RoutingDto = z.object({
  slackChannelId: z.string().min(1).max(32),
  purpose: z.enum(['default', 'escalations']).optional(),
  mention: z.string().max(64).nullish(),
});

@Controller('v1/slack')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  @Get()
  status(): Promise<SlackStatusDto> {
    return this.slack.status();
  }

  @Get('install-url')
  installUrl(): { url: string; expiresAt: string } {
    return this.slack.installUrl();
  }

  @Put('routing')
  setRouting(@Body() body: unknown): Promise<SlackRouteDto & { botInChannel: boolean }> {
    const parsed = RoutingDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.slack.setRouting({
      slackChannelId: parsed.data.slackChannelId,
      purpose: parsed.data.purpose,
      mention: parsed.data.mention ?? undefined,
    });
  }

  @Post('test')
  @HttpCode(200)
  sendTest(): Promise<{ ok: true; slackChannelId: string; ts: string }> {
    return this.slack.sendTest();
  }

  @Delete()
  @HttpCode(204)
  async disconnect(): Promise<void> {
    await this.slack.disconnect();
  }
}
