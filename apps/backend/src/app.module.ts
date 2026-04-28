import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module.js';
import { HealthController } from './common/health.controller.js';
import { WhoamiController } from './common/whoami.controller.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { TenancyInterceptor } from './common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { McpModule } from './mcp/mcp.module.js';
import { ControlModule } from './control/control.module.js';
import { AuthModule } from './auth/auth.module.js';
import { KbModule } from './modules/kb/kb.module.js';

@Module({
  imports: [DbModule, AuthModule, McpModule, ControlModule, KbModule],
  controllers: [HealthController, WhoamiController],
  providers: [AuthGuard, TenancyInterceptor, AuditInterceptor],
})
export class AppModule {}
