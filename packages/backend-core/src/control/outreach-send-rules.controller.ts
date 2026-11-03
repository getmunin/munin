import { Body, Controller, Get, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  OutreachSendRulesService,
  SendRulesInput,
  type SendRulesDto,
} from '../modules/outreach/send-rules.ts';

class PutSendRulesBody extends createZodDto(SendRulesInput) {}

@Controller('v1/outreach/send-rules')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OutreachSendRulesController {
  constructor(private readonly rules: OutreachSendRulesService) {}

  @Get()
  get(): Promise<SendRulesDto> {
    return this.rules.get();
  }

  @Put()
  @RequireRole('owner', 'admin')
  update(@Body() input: PutSendRulesBody): Promise<SendRulesDto> {
    return this.rules.configure(input);
  }
}
