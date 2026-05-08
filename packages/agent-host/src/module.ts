import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import type { Db } from '@getmunin/db';
import { AgentConfigService } from './config.service.js';
import { AgentConfigController } from './config.controller.js';
import { AgentModelsService } from './models.service.js';
import { AgentHostRunner, type AgentHostRunnerOptions } from './runner.service.js';
import {
  ADMIN_KEY_PROVIDER,
  AGENT_CONFIG_REPOSITORY,
  AGENT_HOST_DB,
} from './injection-tokens.js';
import type { AgentConfigRepository } from './config.repository.js';
import type { AdminKeyProvider } from './admin-key-provider.js';

export interface AgentHostModuleOptions {
  configRepository: Type<AgentConfigRepository>;
  adminKeyProvider: Type<AdminKeyProvider>;
  db: Db;
  runnerOptions?: AgentHostRunnerOptions;
}

@Module({})
export class AgentHostModule {
  static forRoot(options: AgentHostModuleOptions): DynamicModule {
    const repoProvider: Provider = {
      provide: AGENT_CONFIG_REPOSITORY,
      useClass: options.configRepository,
    };
    const keyProvider: Provider = {
      provide: ADMIN_KEY_PROVIDER,
      useClass: options.adminKeyProvider,
    };
    const dbProvider: Provider = {
      provide: AGENT_HOST_DB,
      useValue: options.db,
    };
    const runnerOptionsProvider: Provider = {
      provide: 'AGENT_HOST_RUNNER_OPTIONS',
      useValue: options.runnerOptions ?? {},
    };
    return {
      module: AgentHostModule,
      providers: [
        repoProvider,
        keyProvider,
        dbProvider,
        runnerOptionsProvider,
        options.configRepository,
        options.adminKeyProvider,
        AgentConfigService,
        AgentModelsService,
        AgentHostRunner,
      ],
      controllers: [AgentConfigController],
      exports: [
        AgentConfigService,
        AgentModelsService,
        AGENT_CONFIG_REPOSITORY,
        ADMIN_KEY_PROVIDER,
        AGENT_HOST_DB,
      ],
    };
  }
}
