import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module.js';
import { HealthController } from './common/health.controller.js';
import { WhoamiController } from './common/whoami.controller.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { TenancyInterceptor } from './common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from './common/audit/audit.interceptor.js';

/**
 * Root module. M0.5 has the auth + tenancy + audit chain wired plus
 * /healthz, /readyz, /version and /whoami for smoke tests.
 *
 * Domain modules (kb, desk, crm), the MCP transport, and the OAuth server
 * land in subsequent commits during M0.4 / M1.
 */
@Module({
  imports: [DbModule],
  controllers: [HealthController, WhoamiController],
  providers: [AuthGuard, TenancyInterceptor, AuditInterceptor],
})
export class AppModule {}
