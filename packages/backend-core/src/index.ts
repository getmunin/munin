/**
 * `@getmunin/backend-core` — reusable Nest building blocks for any Munin
 * backend (OSS `apps/backend` or downstream apps). Auth modules are
 * intentionally NOT included here; each consumer wires its own.
 */
export {
  BACKEND_FEATURE_MODULES_NO_AUTH,
  BACKEND_BASE_CONTROLLERS,
  BACKEND_BASE_PROVIDERS,
} from './app.module.js';

export { createApp } from './bootstrap-app.js';

export {
  handleAuthRequest,
  requireAuthSecret,
} from './auth-controller-factory.js';

export {
  createRedisRateLimitStore,
  type BetterAuthRateLimitEntry,
  type BetterAuthRateLimitStorage,
  type CreateRedisRateLimitStoreOptions,
} from './auth/better-auth-redis-store.js';

export {
  readGoogleProviderFromEnv,
  readTrustedOriginsFromEnv,
} from './auth-env.js';

// Common building blocks
export {
  AuthGuard,
  AllowAnonymous,
  type AuthenticatedRequest,
  ALLOW_ANONYMOUS,
  ADDITIONAL_CREDENTIAL_RESOLVERS,
  type AdditionalCredentialResolver,
} from './common/auth/auth.guard.js';
export { TenancyInterceptor } from './common/tenancy/tenancy.interceptor.js';
export { AuditInterceptor } from './common/audit/audit.interceptor.js';
export { DB, DbModule } from './common/db/db.module.js';
export { MAILER, MailModule } from './common/mail/mail.module.js';
export { STORAGE } from './common/storage/storage.token.js';
export { StorageModule } from './common/storage/storage.module.js';

// Feature modules (re-export so cloud can selectively replace any of them
// if it ever needs to — currently it just composes the array as-is).
export { McpModule } from './mcp/mcp.module.js';
export { ControlModule } from './control/control.module.js';
export { KbModule } from './modules/kb/kb.module.js';
export { BootstrapModule } from './modules/bootstrap/bootstrap.module.js';
export { ConvModule } from './modules/conv/conv.module.js';
export { CrmModule } from './modules/crm/crm.module.js';
export { CmsModule } from './modules/cms/cms.module.js';
export { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
export { QuotasModule } from './common/quotas/quotas.module.js';
export { WebhookModule } from './common/webhooks/webhook.module.js';
export { OAuthModule } from './oauth/oauth.module.js';
export {
  MCP_RESOURCE_PATH,
  SUPPORTED_SCOPES,
  type SupportedScope,
  mcpResourceUrl,
  authorizationServerUrl,
  resourceMetadataUrl,
} from './oauth/oauth.constants.js';

export { HealthController } from './common/health.controller.js';
export { WhoamiController } from './common/whoami.controller.js';
