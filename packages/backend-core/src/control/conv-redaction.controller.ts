import { Body, Controller, Get, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  InboundRedactionService,
  type RedactionPolicyDto,
} from '../modules/conv/inbound-redaction.service.ts';

class PutRedactionBody extends createZodDto(
  z.object({
    detectors: z.array(z.enum(['no_fnr', 'se_pnr', 'dk_cpr'])),
    policy: z.enum(['off', 'mask', 'remove']),
    minConfidence: z.enum(['high', 'medium']).optional(),
  }),
) {}

@Controller('v1/conversations/redaction')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class ConvRedactionController {
  constructor(private readonly redaction: InboundRedactionService) {}

  @Get()
  get(): Promise<RedactionPolicyDto> {
    return this.redaction.getPolicy();
  }

  @Put()
  @RequireRole('owner', 'admin')
  update(@Body() input: PutRedactionBody): Promise<RedactionPolicyDto> {
    return this.redaction.configure(input);
  }
}
