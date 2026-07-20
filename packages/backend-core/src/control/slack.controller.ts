import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  SlackService,
  SLACK_INSTALL_NONCE_COOKIE,
  type SlackRouteDto,
  type SlackStatusDto,
} from '../modules/slack/slack.service.ts';

const INSTALL_NONCE_MAX_AGE_MS = 10 * 60 * 1000;

const RoutingDto = z.object({
  slackChannelId: z.string().min(1).max(32),
  purpose: z.enum(['default', 'escalations']).optional(),
  mention: z.string().max(64).nullish(),
  convChannelId: z.string().max(64).nullish(),
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
  installUrl(@Res({ passthrough: true }) res: Response): { url: string; expiresAt: string } {
    const result = this.slack.installUrl({ bindToSession: true });
    if (result.sessionNonce) {
      res.cookie(SLACK_INSTALL_NONCE_COOKIE, result.sessionNonce, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/v1/slack/oauth',
        maxAge: INSTALL_NONCE_MAX_AGE_MS,
      });
    }
    return { url: result.url, expiresAt: result.expiresAt };
  }

  @Put('routing')
  setRouting(@Body() body: unknown): Promise<SlackRouteDto & { botInChannel: boolean }> {
    const parsed = RoutingDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.slack.setRouting({
      slackChannelId: parsed.data.slackChannelId,
      purpose: parsed.data.purpose,
      mention: parsed.data.mention ?? undefined,
      convChannelId: parsed.data.convChannelId ?? undefined,
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
