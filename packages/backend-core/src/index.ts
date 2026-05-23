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
  readGoogleProviderFromEnv,
  readTrustedOriginsFromEnv,
} from './auth-env.js';

export {
  createMuninAuthCore,
  computeValidAudiences,
  STANDARD_OIDC_SCOPES,
  SUPPORTED_AUTH_SCOPES,
  type MuninAuthCoreOptions,
  type MuninAuthInstance,
  type SignupHookUser,
  type SignupBeforeUser,
  type DeleteUserConfig,
} from './auth/auth-factory.js';

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

export { McpModule } from './mcp/mcp.module.js';
export { McpRegistryService } from './mcp/mcp.registry.js';
export { McpSkillRegistryService } from './mcp/mcp.skill-registry.service.js';
export {
  RealtimeEventBus,
  type RealtimeBusHandlers,
  type RealtimeBusSubscription,
  type RealtimeBusSubscriptionFilter,
  type MessageReceivedBusEvent,
  type KbDocumentChangedBusEvent,
  type HandoverResolvedBusEvent,
  type CuratorJobPendingBusEvent,
  type GreetRequestedBusEvent,
  type AgentConfigChangedBusEvent,
  type AgentTypingBusEvent,
} from './realtime/realtime-event-bus.js';
export { RealtimeModule } from './realtime/realtime.module.js';
export {
  openAdminAgentMcpClient,
  openEndUserAgentMcpClient,
  type AgentMcpClient,
  type OpenAdminAgentMcpClientOptions,
  type OpenEndUserAgentMcpClientOptions,
} from './agent/in-process-context.js';
export { ControlModule } from './control/control.module.js';
export { KbModule } from './modules/kb/kb.module.js';
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
