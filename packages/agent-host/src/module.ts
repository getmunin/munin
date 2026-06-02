import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import {
  AgentRunnerSupportModule,
  AlertsService,
  DB,
  DbModule,
  McpModule,
  RealtimeModule,
} from '@getmunin/backend-core';
import { AgentConfigService } from './config.service.ts';
import { AgentConfigController } from './config.controller.ts';
import { AgentModelsService } from './models.service.ts';
import { AgentHealthService } from './agent-health.service.ts';
import { AgentHostRunner, type AgentHostRunnerOptions } from './runner.service.ts';
import { AGENT_CONFIG_REPOSITORY, AGENT_HOST_DB, ALERT_RECORDER } from './injection-tokens.ts';
import type { AgentConfigRepository } from './config.repository.ts';

export interface AgentHostModuleOptions {
  configRepository: Type<AgentConfigRepository>;
  runnerOptions?: AgentHostRunnerOptions;
}

@Module({})
export class AgentHostModule {
  static forRoot(options: AgentHostModuleOptions): DynamicModule {
    const repoProvider: Provider = {
      provide: AGENT_CONFIG_REPOSITORY,
      useClass: options.configRepository,
    };
    const dbAliasProvider: Provider = {
      provide: AGENT_HOST_DB,
      useExisting: DB,
    };
    const runnerOptionsProvider: Provider = {
      provide: 'AGENT_HOST_RUNNER_OPTIONS',
      useValue: options.runnerOptions ?? {},
    };
    const alertRecorderProvider: Provider = {
      provide: ALERT_RECORDER,
      useExisting: AlertsService,
    };
    return {
      module: AgentHostModule,
      imports: [DbModule, McpModule, RealtimeModule, AgentRunnerSupportModule],
      providers: [
        repoProvider,
        dbAliasProvider,
        runnerOptionsProvider,
        alertRecorderProvider,
        options.configRepository,
        AgentConfigService,
        AgentModelsService,
        AgentHealthService,
        AgentHostRunner,
      ],
      controllers: [AgentConfigController],
      exports: [
        AgentConfigService,
        AgentModelsService,
        AgentHealthService,
        AGENT_CONFIG_REPOSITORY,
        AGENT_HOST_DB,
      ],
    };
  }
}
