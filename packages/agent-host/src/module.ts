import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import {
  AgentRunnerSupportModule,
  DB,
  DbModule,
  McpModule,
  RealtimeModule,
} from '@getmunin/backend-core';
import { AgentConfigService } from './config.service.js';
import { AgentConfigController } from './config.controller.js';
import { AgentModelsService } from './models.service.js';
import { AgentHostRunner, type AgentHostRunnerOptions } from './runner.service.js';
import { AGENT_CONFIG_REPOSITORY, AGENT_HOST_DB } from './injection-tokens.js';
import type { AgentConfigRepository } from './config.repository.js';

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
    return {
      module: AgentHostModule,
      imports: [DbModule, McpModule, RealtimeModule, AgentRunnerSupportModule],
      providers: [
        repoProvider,
        dbAliasProvider,
        runnerOptionsProvider,
        options.configRepository,
        AgentConfigService,
        AgentModelsService,
        AgentHostRunner,
      ],
      controllers: [AgentConfigController],
      exports: [
        AgentConfigService,
        AgentModelsService,
        AGENT_CONFIG_REPOSITORY,
        AGENT_HOST_DB,
      ],
    };
  }
}
