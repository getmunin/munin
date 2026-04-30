import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module.js';
import { HealthController } from './common/health.controller.js';
import { WhoamiController } from './common/whoami.controller.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { TenancyInterceptor } from './common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { McpModule } from './mcp/mcp.module.js';
import { ControlModule } from './control/control.module.js';
import { KbModule } from './modules/kb/kb.module.js';
import { BootstrapModule } from './modules/bootstrap/bootstrap.module.js';
import { ConvModule } from './modules/conv/conv.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { CmsModule } from './modules/cms/cms.module.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { QuotasModule } from './common/quotas/quotas.module.js';
import { MailModule } from './common/mail/mail.module.js';
import { WebhookModule } from './common/webhooks/webhook.module.js';
import { StorageModule } from './common/storage/storage.module.js';

/**
 * Feature modules shared between OSS and cloud builds. Each edition
 * composes these with its own AuthModule (single-tenant for OSS,
 * multi-tenant for cloud) plus any edition-specific modules.
 */
export const BACKEND_FEATURE_MODULES_NO_AUTH = [
  DbModule,
  MailModule,
  StorageModule,
  WebhookModule,
  RateLimitModule,
  QuotasModule,
  McpModule,
  ControlModule,
  KbModule,
  BootstrapModule,
  ConvModule,
  CrmModule,
  CmsModule,
];

export const BACKEND_BASE_CONTROLLERS = [HealthController, WhoamiController];
export const BACKEND_BASE_PROVIDERS = [AuthGuard, TenancyInterceptor, AuditInterceptor];

/**
 * Test-only AppModule: composes the feature modules without an Auth
 * module. Integration tests in this package seed via direct DB access and
 * authenticate via API keys, so they don't need BetterAuth wired up. OSS
 * (`apps/backend`) and cloud (`apps/backend-cloud`) compose their own
 * AppModule with the appropriate AuthModule for production.
 */
@Module({
  imports: BACKEND_FEATURE_MODULES_NO_AUTH,
  controllers: BACKEND_BASE_CONTROLLERS,
  providers: BACKEND_BASE_PROVIDERS,
})
export class AppModule {}
