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
  type SocialPendingGrantDto,
  type SocialPlatformAppDto,
} from '../modules/social/social-accounts.service.ts';
import { SocialService, type SocialPublishTarget } from '../modules/social/social.service.ts';

const PlatformBody = z.object({ platform: z.enum(SOCIAL_PLATFORMS) });

const SelectTargetBody = z.object({ externalAccountId: z.string().min(1).max(200) });

const PlatformAppBody = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500).optional(),
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

  @Get('pending/:id')
  pendingTargets(@Param('id') id: string): Promise<SocialPendingGrantDto> {
    return this.accounts.listPendingTargets(id);
  }

  @Post('pending/:id/select')
  selectTarget(@Param('id') id: string, @Body() body: unknown): Promise<SocialAccountDto> {
    return this.accounts.selectTarget({
      pendingId: id,
      externalAccountId: SelectTargetBody.parse(body).externalAccountId,
    });
  }

  @Delete(':id')
  disconnect(@Param('id') id: string): Promise<{ disconnected: true; id: string }> {
    return this.accounts.disconnect(id);
  }
}
