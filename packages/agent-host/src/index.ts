export {
  agentConfig,
  AGENT_HOST_SINGLETON_DDL,
  AGENT_HOST_MULTI_TENANT_DDL,
  SINGLETON_ID,
} from './schema.js';

export type {
  AgentConfigRow,
  AgentConfigPatch,
  AgentConfigRepository,
} from './config.repository.js';

export { SingletonConfigRepository } from './singleton-config.repository.js';
export { PerOrgConfigRepository } from './per-org-config.repository.js';

export {
  AGENT_CONFIG_REPOSITORY,
  ADMIN_KEY_PROVIDER,
  AGENT_HOST_DB,
} from './injection-tokens.js';

export { AgentHostRunner, type AgentHostRunnerOptions } from './runner.service.js';
export { runWithServiceContext } from './service-context.js';
export { AgentHostModule, type AgentHostModuleOptions } from './module.js';
export { ReplicaLockManager } from './replica-lock.js';

export { AgentConfigService, type AgentConfigDto } from './config.service.js';
export { AgentConfigController } from './config.controller.js';
export {
  AgentModelsService,
  type ListModelsResult,
  type ModelEntry,
} from './models.service.js';

export { type AdminKeyProvider, NoopAdminKeyProvider } from './admin-key-provider.js';
export { AutoMintAdminKeyProvider } from './auto-mint-admin-key-provider.js';
