export {
  agentConfig,
  AGENT_HOST_SINGLETON_DDL,
  AGENT_HOST_MULTI_TENANT_DDL,
  SINGLETON_ID,
} from './schema.ts';

export {
  agentHealth,
  AGENT_HEALTH_SINGLETON_DDL,
  AGENT_HEALTH_MULTI_TENANT_DDL,
} from './agent-health.schema.ts';

export type {
  AgentConfigRow,
  AgentConfigPatch,
  AgentConfigRepository,
} from './config.repository.ts';

export { SingletonConfigRepository } from './singleton-config.repository.ts';
export { PerOrgConfigRepository } from './per-org-config.repository.ts';

export { AGENT_CONFIG_REPOSITORY, AGENT_HOST_DB, ALERT_RECORDER } from './injection-tokens.ts';
export type { AlertRecorder } from './alert-recorder.ts';

export { AgentHostRunner, type AgentHostRunnerOptions } from './runner.service.ts';
export { runWithServiceContext } from './service-context.ts';
export { AgentHostModule, type AgentHostModuleOptions } from './module.ts';
export { ReplicaLockManager } from './replica-lock.ts';

export { AgentConfigService, type AgentConfigDto } from './config.service.ts';
export { AgentConfigController } from './config.controller.ts';
export {
  AgentHealthService,
  type AgentHealthDto,
  type AgentHealthStatus,
} from './agent-health.service.ts';
export {
  AgentModelsService,
  type ListModelsResult,
  type ModelEntry,
} from './models.service.ts';
