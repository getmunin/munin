import {
  DynamicModule,
  Module,
  Provider,
  Type,
  type InjectionToken,
  type ModuleMetadata,
  type OptionalFactoryDependency,
} from '@nestjs/common';
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
import {
  AGENT_CONFIG_REPOSITORY,
  AGENT_HOST_DB,
  ALERT_RECORDER,
  DEFAULT_PROVIDER_AVAILABLE,
} from './injection-tokens.ts';
import type { AgentConfigRepository } from './config.repository.ts';

const RUNNER_OPTIONS = 'AGENT_HOST_RUNNER_OPTIONS';

export interface AgentHostModuleOptions {
  configRepository: Type<AgentConfigRepository>;
  runnerOptions?: AgentHostRunnerOptions;
  defaultProviderAvailable?: boolean;
}

export interface AgentHostModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  configRepository: Type<AgentConfigRepository>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: never[]) => AgentHostRunnerOptions | Promise<AgentHostRunnerOptions>;
  defaultProviderAvailable?: boolean;
}

@Module({})
export class AgentHostModule {
  static forRoot(options: AgentHostModuleOptions): DynamicModule {
    return buildModule(
      options.configRepository,
      { provide: RUNNER_OPTIONS, useValue: options.runnerOptions ?? {} },
      [],
      options.defaultProviderAvailable ?? false,
    );
  }

  static forRootAsync(options: AgentHostModuleAsyncOptions): DynamicModule {
    return buildModule(
      options.configRepository,
      {
        provide: RUNNER_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      options.imports ?? [],
      options.defaultProviderAvailable ?? false,
    );
  }
}

function buildModule(
  configRepository: Type<AgentConfigRepository>,
  runnerOptionsProvider: Provider,
  extraImports: NonNullable<ModuleMetadata['imports']> = [],
  defaultProviderAvailable = false,
): DynamicModule {
  return {
    module: AgentHostModule,
    imports: [DbModule, McpModule, RealtimeModule, AgentRunnerSupportModule, ...extraImports],
    providers: [
      { provide: AGENT_CONFIG_REPOSITORY, useClass: configRepository },
      { provide: AGENT_HOST_DB, useExisting: DB },
      { provide: DEFAULT_PROVIDER_AVAILABLE, useValue: defaultProviderAvailable },
      runnerOptionsProvider,
      { provide: ALERT_RECORDER, useExisting: AlertsService },
      configRepository,
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
