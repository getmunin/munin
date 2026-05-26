export {
  agentConfig,
  AGENT_HOST_SINGLETON_DDL,
  AGENT_HOST_MULTI_TENANT_DDL,
  SINGLETON_ID,
} from './schema.js';

export {
  agentHealth,
  AGENT_HEALTH_SINGLETON_DDL,
  AGENT_HEALTH_MULTI_TENANT_DDL,
} from './agent-health.schema.js';

export type {
  AgentConfigRow,
  AgentConfigPatch,
  AgentConfigRepository,
} from './config.repository.js';

export { SingletonConfigRepository } from './singleton-config.repository.js';
export { PerOrgConfigRepository } from './per-org-config.repository.js';

export { AGENT_CONFIG_REPOSITORY, AGENT_HOST_DB } from './injection-tokens.js';

export { AgentHostRunner, type AgentHostRunnerOptions } from './runner.service.js';
export { runWithServiceContext } from './service-context.js';
export { AgentHostModule, type AgentHostModuleOptions } from './module.js';
export { ReplicaLockManager } from './replica-lock.js';

export { AgentConfigService, type AgentConfigDto } from './config.service.js';
export { AgentConfigController } from './config.controller.js';
export {
  AgentHealthService,
  type AgentHealthDto,
  type AgentHealthStatus,
} from './agent-health.service.js';
export { AgentHealthController } from './agent-health.controller.js';
export {
  AgentModelsService,
  type ListModelsResult,
  type ModelEntry,
} from './models.service.js';
