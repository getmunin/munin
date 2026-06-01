import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AuditInterceptor,
  AuthGuard,
  TenancyInterceptor,
  RoleGuard,
  RequireRole,
  RequireActorType,
} from '@getmunin/backend-core';
import { AgentConfigService, type AgentConfigDto } from './config.service.ts';
import { AgentModelsService, type ListModelsResult } from './models.service.ts';

function allowPrivateProviderHosts(): boolean {
  const v = process.env.MUNIN_SSRF_ALLOW_PRIVATE;
  return v === '1' || v === 'true';
}

export const ProviderBaseUrl = z
  .string()
  .url()
  .refine((raw) => {
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:') return true;
      return u.protocol === 'http:' && allowPrivateProviderHosts();
    } catch {
      return false;
    }
  }, 'provider base URL must use https:// (http:// only allowed when MUNIN_SSRF_ALLOW_PRIVATE is set)');

const UpsertDto = z.object({
  fastModel: z.string().min(1).optional(),
  smartModel: z.string().min(1).nullable().optional(),
  providerBaseUrl: ProviderBaseUrl.optional(),
  providerApiKey: z.string().min(1).nullable().optional(),
  maxHistoryChars: z.number().int().positive().optional(),
  maxToolIterations: z.number().int().positive().optional(),
  debounceMs: z.number().int().nonnegative().optional(),
});

@Controller('v1/agent-config')
@UseGuards(AuthGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireActorType('user')
export class AgentConfigController {
  constructor(
    @Inject(AgentConfigService) private readonly service: AgentConfigService,
    @Inject(AgentModelsService) private readonly models: AgentModelsService,
  ) {}

  @Get()
  async get(): Promise<AgentConfigDto> {
    return this.service.getForCurrentActor();
  }

  @Put()
  @RequireRole('owner', 'admin')
  async upsert(@Body() body: unknown): Promise<AgentConfigDto> {
    const parsed = UpsertDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.service.upsertForCurrentActor(parsed.data);
  }

  @Get('models')
  @RequireRole('owner', 'admin')
  async listModels(): Promise<ListModelsResult> {
    return this.models.listForCurrentActor();
  }
}
