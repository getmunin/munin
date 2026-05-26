import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { AGENT_CONFIG_REPOSITORY } from './injection-tokens.js';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.js';
import { validateProviderCredentials } from './provider-auth.js';
import { AgentHealthService, type AgentHealthRecorder } from './agent-health.service.js';

export interface AgentConfigDto {
  id: string;
  fastModel: string;
  smartModel: string | null;
  providerBaseUrl: string;
  providerApiKeySet: boolean;
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
  ) {}

  async getForCurrentActor(): Promise<AgentConfigDto> {
    const id = this.repo.resolveCurrentId();
    const row = await this.repo.read(id);
    return toDto(row);
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

    const after = await this.repo.update(id, input);

    await this.webhooks.emit({
      type: 'agent.config.updated',
      payload: { configId: id },
    });

    if (credentialsValidated) {
      await this.health.recordSuccess(id).catch((err) => {
        this.log.warn(`recordSuccess after save failed for ${id}: ${describe(err)}`);
      });
    }

    return toDto(after);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toDto(row: AgentConfigRow): AgentConfigDto {
  return {
    id: row.id,
    fastModel: row.fastModel,
    smartModel: row.smartModel,
    providerBaseUrl: row.providerBaseUrl,
    providerApiKeySet: row.providerApiKeySet,
    maxHistoryChars: row.maxHistoryChars,
    maxToolIterations: row.maxToolIterations,
    debounceMs: row.debounceMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
