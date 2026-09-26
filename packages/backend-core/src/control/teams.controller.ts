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
import type { CredentialLink } from '../modules/credential-handoff/credential-handoff.service.ts';
import {
  TeamsService,
  type TeamsChannelOption,
  type TeamsIntegrationDto,
  type TeamsRouteDto,
  type TeamsStatusDto,
} from '../modules/teams/teams.service.ts';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CreateTeamsConnectionBody extends createZodDto(
  z.object({
    appId: z.string().regex(GUID),
    tenantId: z.string().regex(GUID),
    appSecret: z.string().min(1).max(512).optional(),
  }),
) {}

class SetTeamsRoutingBody extends createZodDto(
  z.object({
    teamsChannelId: z.string().min(1).max(256),
    purpose: z.enum(['default', 'escalations']).optional(),
    convChannelId: z.string().max(64).nullish(),
  }),
) {}

@Controller('v1/teams')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  status(): Promise<TeamsStatusDto> {
    return this.teams.status();
  }

  @Post('connection')
  createConnection(@Body() input: CreateTeamsConnectionBody): Promise<{
    integration: TeamsIntegrationDto;
    messagingEndpoint: string;
    credentials: CredentialLink | null;
  }> {
    return this.teams.createConnection({ appId: input.appId, tenantId: input.tenantId, appSecret: input.appSecret });
  }

  @Post('credentials-link')
  @HttpCode(200)
  requestCredentials(): Promise<CredentialLink> {
    return this.teams.requestCredentials();
  }

  @Get('app-package')
  async appPackage(): Promise<{ filename: string; contentType: string; base64: string }> {
    const pkg = await this.teams.appPackage();
    return { filename: pkg.filename, contentType: 'application/zip', base64: pkg.data.toString('base64') };
  }

  @Get('channels')
  listChannels(): Promise<{ channels: TeamsChannelOption[] }> {
    return this.teams.listChannels();
  }

  @Put('routing')
  setRouting(@Body() input: SetTeamsRoutingBody): Promise<TeamsRouteDto> {
    return this.teams.setRouting({
      teamsChannelId: input.teamsChannelId,
      purpose: input.purpose,
      convChannelId: input.convChannelId ?? undefined,
    });
  }

  @Post('test')
  @HttpCode(200)
  sendTest(): Promise<{ ok: true; teamsChannelId: string; activityId: string }> {
    return this.teams.sendTest();
  }

  @Delete()
  @HttpCode(204)
  async disconnect(): Promise<void> {
    await this.teams.disconnect();
  }
}
