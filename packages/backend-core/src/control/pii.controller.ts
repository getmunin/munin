import { Body, Controller, Get, Param, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  PiiStatusService,
  type PiiStatusDto,
  type PiiTokenIdentityDto,
} from '../modules/pii/pii-status.service.ts';

class PutPiiPolicyBody extends createZodDto(
  z
    .object({
      externalRaw: z.enum(['allow', 'forbid']).optional(),
      withholdUncheckedText: z.boolean().optional(),
    })
    .refine((body) => body.externalRaw !== undefined || body.withholdUncheckedText !== undefined, {
      message: 'pii_policy_invalid: set externalRaw, withholdUncheckedText, or both',
    }),
) {}

@Controller('v1/pii')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class PiiController {
  constructor(private readonly status: PiiStatusService) {}

  @Get()
  get(): Promise<PiiStatusDto> {
    return this.status.getStatus();
  }

  @Put()
  @RequireRole('owner', 'admin')
  update(@Body() input: PutPiiPolicyBody): Promise<PiiStatusDto> {
    return this.status.configure(input);
  }

  @Get('tokens/:token')
  @RequireRole('owner', 'admin')
  lookup(@Param('token') token: string): Promise<PiiTokenIdentityDto> {
    return this.status.lookupToken(token);
  }
}
