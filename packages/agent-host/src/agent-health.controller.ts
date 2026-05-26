import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { getCurrentContext } from '@getmunin/core';
import { AuditInterceptor, AuthGuard, TenancyInterceptor } from '@getmunin/backend-core';
import { AgentHealthService, type AgentHealthDto } from './agent-health.service.js';

@Controller('api/v1/agent-health')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class AgentHealthController {
  constructor(@Inject(AgentHealthService) private readonly service: AgentHealthService) {}

  @Get()
  async get(): Promise<AgentHealthDto> {
    requireUserActor();
    return this.service.getForCurrentActor();
  }
}

function requireUserActor(): void {
  const actor = getCurrentContext().actor;
  if (!actor || actor.type !== 'user') {
    throw new ForbiddenException('agent health is only readable from a signed-in dashboard session');
  }
}
