import { Inject, Injectable } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { AGENT_CONFIG_REPOSITORY, ADMIN_KEY_PROVIDER } from './injection-tokens.js';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.js';
import type { AdminKeyProvider } from './admin-key-provider.js';
import { validateProviderCredentials } from './provider-auth.js';

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
  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly repo: AgentConfigRepository,
    @Inject(ADMIN_KEY_PROVIDER) private readonly adminKey: AdminKeyProvider,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  async getForCurrentActor(): Promise<AgentConfigDto> {
    const id = this.repo.resolveCurrentId();
    const row = await this.repo.read(id);
    return toDto(row);
  }

  async upsertForCurrentActor(input: AgentConfigPatch): Promise<AgentConfigDto> {
    const id = this.repo.resolveCurrentId();
    const before = await this.repo.read(id);

    if (input.providerBaseUrl !== undefined || input.providerApiKey !== undefined) {
      const baseUrl = input.providerBaseUrl ?? before.providerBaseUrl;
      const apiKey =
        input.providerApiKey !== undefined
          ? input.providerApiKey
          : await this.repo.readDecryptedProviderKey(id);
      if (apiKey) await validateProviderCredentials(baseUrl, apiKey);
    }

    const after = await this.repo.update(id, input);

    const wasProvisioned = before.providerApiKeySet;
    const isProvisioned = after.providerApiKeySet;

    if (isProvisioned && !before.adminApiKeyId) {
      await this.adminKey.mint(id);
    } else if (wasProvisioned && !isProvisioned && before.adminApiKeyId) {
      await this.adminKey.revoke(id, before.adminApiKeyId);
    }

    await this.webhooks.emit({
      type: 'agent.config.updated',
      payload: { configId: id },
    });

    return toDto(after);
  }
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
