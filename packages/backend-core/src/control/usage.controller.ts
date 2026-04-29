import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.js';

@Controller('api/usage')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class UsageController {
  constructor(@Inject(RateLimitService) private readonly rateLimit: RateLimitService) {}

  @Get()
  current() {
    return this.rateLimit.usage();
  }
}
