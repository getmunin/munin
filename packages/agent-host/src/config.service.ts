import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { AGENT_CONFIG_REPOSITORY, DEFAULT_PROVIDER_AVAILABLE } from './injection-tokens.ts';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.ts';
import { validateProviderCredentials } from './provider-auth.ts';
import { AgentHealthService, type AgentHealthRecorder } from './agent-health.service.ts';

export interface AgentConfigDto {
  id: string;
  fastModel: string;
  smartModel: string | null;
  providerBaseUrl: string;
  providerApiKeySet: boolean;
  providerConfigured: boolean;
  maxHistoryChars: number;
  maxToolIterations: number;
  debounceMs: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AgentConfigService {
  private readonly log = new Logger('AgentConfigService');

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly repo: AgentConfigRepository,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(AgentHealthService) private readonly health: AgentHealthRecorder,
    @Optional()
    @Inject(DEFAULT_PROVIDER_AVAILABLE)
    private readonly defaultProviderAvailable: boolean = false,
  ) {}

  async getForCurrentActor(): Promise<AgentConfigDto> {
    const id = this.repo.resolveCurrentId();
    const row = await this.repo.read(id);
    return toDto(row, this.defaultProviderAvailable);
  }

  async upsertForCurrentActor(input: AgentConfigPatch): Promise<AgentConfigDto> {
    const id = this.repo.resolveCurrentId();
    const before = await this.repo.read(id);

    let credentialsValidated = false;
    if (input.providerBaseUrl !== undefined || input.providerApiKey !== undefined) {
      const baseUrl = input.providerBaseUrl ?? before.providerBaseUrl;
      const apiKey =
        input.providerApiKey !== undefined
          ? input.providerApiKey
          : await this.repo.readDecryptedProviderKey(id);
      if (apiKey) {
        await validateProviderCredentials(baseUrl, apiKey);
        credentialsValidated = true;
      }
    }

    const modelChanged =
      (input.fastModel !== undefined && input.fastModel !== before.fastModel) ||
      (input.smartModel !== undefined && input.smartModel !== before.smartModel);

    const after = await this.repo.update(id, input);

    await this.webhooks.emit({
      type: 'agent.config.updated',
      payload: { configId: id },
    });

    if (credentialsValidated || modelChanged) {
      await this.health.recordSuccess(id).catch((err) => {
        this.log.warn(`recordSuccess after save failed for ${id}: ${describe(err)}`);
      });
    }

    return toDto(after, this.defaultProviderAvailable);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toDto(row: AgentConfigRow, defaultProviderAvailable: boolean): AgentConfigDto {
  return {
    id: row.id,
    fastModel: row.fastModel,
    smartModel: row.smartModel,
    providerBaseUrl: row.providerBaseUrl,
    providerApiKeySet: row.providerApiKeySet,
    providerConfigured: row.providerApiKeySet || defaultProviderAvailable,
    maxHistoryChars: row.maxHistoryChars,
    maxToolIterations: row.maxToolIterations,
    debounceMs: row.debounceMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
