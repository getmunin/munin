import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { getCurrentContext } from '@getmunin/core';
import { AuditInterceptor, AuthGuard, TenancyInterceptor } from '@getmunin/backend-core';
import { AgentConfigService, type AgentConfigDto } from './config.service.js';
import { AgentModelsService, type ListModelsResult } from './models.service.js';

const UpsertDto = z.object({
  fastModel: z.string().min(1).optional(),
  smartModel: z.string().min(1).nullable().optional(),
  providerBaseUrl: z.string().url().optional(),
  providerApiKey: z.string().min(1).nullable().optional(),
  maxHistoryChars: z.number().int().positive().optional(),
  maxToolIterations: z.number().int().positive().optional(),
  debounceMs: z.number().int().nonnegative().optional(),
});

@Controller('api/v1/agent-config')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class AgentConfigController {
  constructor(
    @Inject(AgentConfigService) private readonly service: AgentConfigService,
    @Inject(AgentModelsService) private readonly models: AgentModelsService,
  ) {}

  @Get()
  async get(): Promise<AgentConfigDto> {
    requireUserActor();
    return this.service.getForCurrentActor();
  }

  @Put()
  async upsert(@Body() body: unknown): Promise<AgentConfigDto> {
    requireUserActor();
    const parsed = UpsertDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.service.upsertForCurrentActor(parsed.data);
  }

  @Get('models')
  async listModels(): Promise<ListModelsResult> {
    requireUserActor();
    return this.models.listForCurrentActor();
  }
}

function requireUserActor(): void {
  const actor = getCurrentContext().actor;
  if (!actor || actor.type !== 'user') {
    throw new ForbiddenException('agent config is only editable from a signed-in dashboard session');
  }
}
