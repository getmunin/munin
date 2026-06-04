export {
  BACKEND_FEATURE_MODULES,
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
  readGithubProviderFromEnv,
  readTrustedOriginsFromEnv,
} from './auth-env.ts';

export { FeedbackModule, isFeedbackEnabled } from './modules/feedback/feedback.module.ts';
export {
  FeedbackService,
  FeedbackNotFoundError,
  FeedbackForwardFailedError,
  type FeedbackOutboxDto,
  type FeedbackAppScope,
} from './modules/feedback/feedback.service.ts';

export { SystemAlertsModule } from './modules/system-alerts/system-alerts.module.ts';
export {
  AlertsService,
  AlertNotFoundError,
  ALERT_SOURCES,
  ALERT_SEVERITIES,
  type AlertDto,
  type AlertSource,
  type AlertSeverity,
  type OpenAlertInput,
  type OpenAlertResult,
  type ResolveAlertInput,
  type ResolveAlertResult,
} from './modules/system-alerts/system-alerts.service.ts';

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
  PublicController,
  type PublicControllerOpts,
  type AuthenticatedRequest,
  ALLOW_ANONYMOUS,
  ADDITIONAL_CREDENTIAL_RESOLVERS,
  type AdditionalCredentialResolver,
} from './common/auth/auth.guard.ts';
export { ControlPlaneGuard } from './common/auth/control-plane.guard.ts';
export {
  assertOwner,
  assertOwnerOrAdmin,
  VALID_ROLES,
  type OrgRole,
} from './control/role-guard.ts';
export { RoleGuard } from './control/role.guard.ts';
export {
  RequireRole,
  RequireActorType,
  REQUIRE_ROLE_KEY,
  REQUIRE_ACTOR_TYPE_KEY,
} from './control/role.decorator.ts';
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
export {
  RateLimitService,
  RateLimitExceededError,
  type Bucket,
} from './common/rate-limit/rate-limit.service.ts';
export { QuotasModule } from './common/quotas/quotas.module.ts';
export {
  QUOTAS_SERVICE,
  QuotasService,
  DefaultQuotasService,
  QuotaExceededError,
  type QuotaResource,
} from './common/quotas/quotas.service.ts';
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
