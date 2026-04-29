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
import { BootstrapModule } from './modules/bootstrap/bootstrap.module.js';
import { SuggestionsModule } from './modules/suggestions/suggestions.module.js';
import { ConvModule } from './modules/conv/conv.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { CmsModule } from './modules/cms/cms.module.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { QuotasModule } from './common/quotas/quotas.module.js';
import { MailModule } from './common/mail/mail.module.js';
import { WebhookModule } from './common/webhooks/webhook.module.js';
import { StorageModule } from './common/storage/storage.module.js';

@Module({
  imports: [
    DbModule,
    MailModule,
    StorageModule,
    WebhookModule,
    RateLimitModule,
    QuotasModule,
    AuthModule,
    McpModule,
    ControlModule,
    KbModule,
    BootstrapModule,
    SuggestionsModule,
    ConvModule,
    CrmModule,
    CmsModule,
  ],
  controllers: [HealthController, WhoamiController],
  providers: [AuthGuard, TenancyInterceptor, AuditInterceptor],
})
export class AppModule {}
