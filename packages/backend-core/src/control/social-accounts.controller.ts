import { Body, Controller, Delete, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { SOCIAL_PLATFORMS } from '../modules/social/social-platform.ts';
import {
  SocialAccountsService,
  type SocialAccountDto,
  type SocialPlatformAppDto,
} from '../modules/social/social-accounts.service.ts';
import { SocialService, type SocialPublishTarget } from '../modules/social/social.service.ts';

const PlatformBody = z.object({ platform: z.enum(SOCIAL_PLATFORMS) });

const PlatformAppBody = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
});

@Controller('v1/social/accounts')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class SocialAccountsController {
  constructor(
    private readonly accounts: SocialAccountsService,
    private readonly social: SocialService,
  ) {}

  @Get()
  list(): Promise<SocialAccountDto[]> {
    return this.accounts.listAccounts();
  }

  @Get('mine')
  mine(): Promise<SocialPublishTarget | null> {
    return this.social.publishTargetForViewer();
  }

  @Get('apps')
  listApps(): Promise<SocialPlatformAppDto[]> {
    return this.accounts.listPlatformApps();
  }

  @Post('apps')
  setApp(@Body() body: unknown): Promise<SocialPlatformAppDto> {
    return this.accounts.setPlatformApp(PlatformAppBody.parse(body));
  }

  @Post('authorize-url')
  authorizeUrl(@Body() body: unknown): Promise<{ url: string; expiresAt: string }> {
    return this.accounts.authorizeUrl(PlatformBody.parse(body));
  }

  @Delete(':id')
  disconnect(@Param('id') id: string): Promise<{ disconnected: true; id: string }> {
    return this.accounts.disconnect(id);
  }
}
