export {
  BACKEND_FEATURE_MODULES_NO_AUTH,
  BACKEND_BASE_CONTROLLERS,
  BACKEND_BASE_PROVIDERS,
} from './app.module.ts';

export { createApp } from './bootstrap-app.ts';

export {
  handleAuthRequest,
  requireAuthSecret,
} from './auth-controller-factory.ts';

export {
  readGoogleProviderFromEnv,
  readTrustedOriginsFromEnv,
} from './auth-env.ts';

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
} from './auth/auth-factory.ts';

export {
  AuthGuard,
  AllowAnonymous,
  type AuthenticatedRequest,
  ALLOW_ANONYMOUS,
  ADDITIONAL_CREDENTIAL_RESOLVERS,
  type AdditionalCredentialResolver,
} from './common/auth/auth.guard.ts';
export { TenancyInterceptor } from './common/tenancy/tenancy.interceptor.ts';
export { AuditInterceptor } from './common/audit/audit.interceptor.ts';
export { DB, DbModule } from './common/db/db.module.ts';
export { MAILER, MailModule } from './common/mail/mail.module.ts';
export { STORAGE } from './common/storage/storage.token.ts';
export { StorageModule } from './common/storage/storage.module.ts';

export { McpModule } from './mcp/mcp.module.ts';
export { McpRegistryService } from './mcp/mcp.registry.ts';
export { McpSkillRegistryService } from './mcp/mcp.skill-registry.service.ts';
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
} from './realtime/realtime-event-bus.ts';
export { RealtimeModule } from './realtime/realtime.module.ts';
export {
  openAdminAgentMcpClient,
  openEndUserAgentMcpClient,
  type AgentMcpClient,
  type OpenAdminAgentMcpClientOptions,
  type OpenEndUserAgentMcpClientOptions,
} from './agent/in-process-context.ts';
export {
  InProcessMuninRestClientFactoryService,
  type MuninRestClientFactory,
} from './agent/in-process-rest-client.ts';
export { AgentRunnerSupportModule } from './agent/agent-runner-support.module.ts';
export { ControlModule } from './control/control.module.ts';
export { KbModule } from './modules/kb/kb.module.ts';
export { ConvModule } from './modules/conv/conv.module.ts';
export { CrmModule } from './modules/crm/crm.module.ts';
export { CmsModule } from './modules/cms/cms.module.ts';
export { RateLimitModule } from './common/rate-limit/rate-limit.module.ts';
export { QuotasModule } from './common/quotas/quotas.module.ts';
export { WebhookModule } from './common/webhooks/webhook.module.ts';
export { OAuthModule } from './oauth/oauth.module.ts';
export {
  MCP_RESOURCE_PATH,
  SUPPORTED_SCOPES,
  type SupportedScope,
  mcpResourceUrl,
  authorizationServerUrl,
  resourceMetadataUrl,
} from './oauth/oauth.constants.ts';

export { HealthController } from './common/health.controller.ts';
export { WhoamiController } from './common/whoami.controller.ts';
export { withSchedulerLock } from './common/scheduler-lock/index.ts';
