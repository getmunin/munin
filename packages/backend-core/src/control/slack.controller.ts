import {
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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  SlackService,
  type InstallUrlResult,
  type SlackRoutingResult,
  type SlackStatusDto,
} from '../modules/slack/slack.service.ts';

class SetSlackRoutingBody extends createZodDto(
  z.object({
    slackChannelId: z.string().min(1).max(32),
    purpose: z.enum(['default', 'escalations']).optional(),
    mention: z.string().max(64).nullish(),
    convChannelId: z.string().max(64).nullish(),
  }),
) {}

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
  installUrl(): InstallUrlResult {
    return this.slack.installUrl();
  }

  @Get('channels')
  listChannels(): Promise<{
    channels: Array<{ id: string; name: string | null; isMember: boolean }>;
  }> {
    return this.slack.listChannels();
  }

  @Put('routing')
  setRouting(@Body() input: SetSlackRoutingBody): Promise<SlackRoutingResult> {
    return this.slack.setRouting({
      slackChannelId: input.slackChannelId,
      purpose: input.purpose,
      mention: input.mention ?? undefined,
      convChannelId: input.convChannelId ?? undefined,
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
