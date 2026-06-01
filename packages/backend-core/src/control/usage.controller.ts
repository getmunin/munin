import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

@Controller('v1/usage')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class UsageController {
  constructor(@Inject(RateLimitService) private readonly rateLimit: RateLimitService) {}

  @Get()
  async current() {
    return this.rateLimit.usage();
  }
}
