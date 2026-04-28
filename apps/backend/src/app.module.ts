import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module.js';
import { HealthController } from './common/health.controller.js';
import { WhoamiController } from './common/whoami.controller.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { TenancyInterceptor } from './common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { McpModule } from './mcp/mcp.module.js';

/**
 * Root module.
 *
 * M0 wiring: shared DB, auth + tenancy + audit guard chain, /healthz,
 * /readyz, /version, /whoami, and the MCP transport at /mcp with a `ping`
 * tool registered via @McpTool.
 *
 * BetterAuth (signup/login), MCP OAuth 2.1 server, REST end-user-token
 * endpoints, and the three domain modules (kb, desk, crm) land in
 * subsequent commits during M0.5 and M1+.
 */
@Module({
  imports: [DbModule, McpModule],
  controllers: [HealthController, WhoamiController],
  providers: [AuthGuard, TenancyInterceptor, AuditInterceptor],
})
export class AppModule {}
