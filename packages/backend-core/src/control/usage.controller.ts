import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.ts';
import { assertOwnerOrAdmin } from './role-guard.ts';

@Controller('v1/usage')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class UsageController {
  constructor(@Inject(RateLimitService) private readonly rateLimit: RateLimitService) {}

  @Get()
  async current() {
    const actor = getCurrentContext().actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
    return this.rateLimit.usage();
  }
}
