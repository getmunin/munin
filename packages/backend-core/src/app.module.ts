import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DbModule } from './common/db/db.module.ts';
import { HealthController } from './common/health.controller.ts';
import { WhoamiController } from './common/whoami.controller.ts';
import { AuthGuard } from './common/auth/auth.guard.ts';
import { TenancyInterceptor } from './common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from './common/audit/audit.interceptor.ts';
import { CallQuotaInterceptor } from './common/quotas/call-quota.interceptor.ts';
import { McpModule } from './mcp/mcp.module.ts';
import { ControlModule } from './control/control.module.ts';
import { KbModule } from './modules/kb/kb.module.ts';
import { ConvModule } from './modules/conv/conv.module.ts';
import { CrmModule } from './modules/crm/crm.module.ts';
import { CmsModule } from './modules/cms/cms.module.ts';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.ts';
import { PublicThrottleModule } from './common/rate-limit/public-throttle.module.ts';
import { QuotasModule } from './common/quotas/quotas.module.ts';
import { MailModule } from './common/mail/mail.module.ts';
import { WebhookModule } from './common/webhooks/webhook.module.ts';
import { StorageModule } from './common/storage/storage.module.ts';
import { RealtimeModule } from './realtime/realtime.module.ts';
import { OAuthModule } from './oauth/oauth.module.ts';

export const BACKEND_FEATURE_MODULES = [
  DbModule,
  MailModule,
  StorageModule,
  WebhookModule,
  RateLimitModule,
  PublicThrottleModule,
  QuotasModule,
  McpModule,
  ControlModule,
  KbModule,
  ConvModule,
  CrmModule,
  CmsModule,
  RealtimeModule,
  OAuthModule,
];

export const BACKEND_BASE_CONTROLLERS = [HealthController, WhoamiController];
export const BACKEND_BASE_PROVIDERS = [
  AuthGuard,
  TenancyInterceptor,
  AuditInterceptor,
  { provide: APP_INTERCEPTOR, useExisting: CallQuotaInterceptor },
];

@Module({
  imports: BACKEND_FEATURE_MODULES,
  controllers: BACKEND_BASE_CONTROLLERS,
  providers: BACKEND_BASE_PROVIDERS,
})
export class AppModule {}
