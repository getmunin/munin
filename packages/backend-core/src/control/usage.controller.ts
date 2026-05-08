import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.js';
import { assertOwnerOrAdmin } from './role-guard.js';

@Controller('api/v1/usage')
@UseGuards(AuthGuard)
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
