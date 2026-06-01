import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  AuditInterceptor,
  AuthGuard,
  TenancyInterceptor,
  RoleGuard,
  RequireActorType,
} from '@getmunin/backend-core';
import { AgentHealthService, type AgentHealthDto } from './agent-health.service.ts';

@Controller('v1/agent-health')
@UseGuards(AuthGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireActorType('user')
export class AgentHealthController {
  constructor(@Inject(AgentHealthService) private readonly service: AgentHealthService) {}

  @Get()
  async get(): Promise<AgentHealthDto> {
    return this.service.getForCurrentActor();
  }
}
