import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { defaultFastModelForBaseUrl } from '@getmunin/types';
import { AGENT_CONFIG_REPOSITORY, DEFAULT_PROVIDER_AVAILABLE } from './injection-tokens.ts';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.ts';
import { validateProviderCredentials } from './provider-auth.ts';
import { AgentHealthService, type AgentHealthRecorder } from './agent-health.service.ts';
import { AgentModelsService, type ProviderModelLister } from './models.service.ts';

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
    @Inject(AgentModelsService) private readonly models: ProviderModelLister,
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

    const credentialsTouched =
      input.providerBaseUrl !== undefined || input.providerApiKey !== undefined;
    const baseUrl = input.providerBaseUrl ?? before.providerBaseUrl;
    const apiKey =
      input.providerApiKey !== undefined
        ? input.providerApiKey
        : await this.repo.readDecryptedProviderKey(id);

    let credentialsValidated = false;
    if (credentialsTouched && apiKey) {
      await validateProviderCredentials(baseUrl, apiKey);
      credentialsValidated = true;
    }

    const patch = await this.resolveModels({
      id,
      input,
      before,
      baseUrl,
      apiKey,
      credentialsTouched,
    });

    const modelChanged =
      (patch.fastModel !== undefined && patch.fastModel !== before.fastModel) ||
      (patch.smartModel !== undefined && patch.smartModel !== before.smartModel);

    const after = await this.repo.update(id, patch);

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

  private async resolveModels(args: {
    id: string;
    input: AgentConfigPatch;
    before: AgentConfigRow;
    baseUrl: string;
    apiKey: string | null;
    credentialsTouched: boolean;
  }): Promise<AgentConfigPatch> {
    const { id, input, before, baseUrl, apiKey, credentialsTouched } = args;
    const modelsTouched = input.fastModel !== undefined || input.smartModel !== undefined;
    if (!apiKey || (!credentialsTouched && !modelsTouched)) return input;

    const offered = await this.offeredModels(id, baseUrl, apiKey);
    if (!offered) return input;

    if (input.fastModel !== undefined && !offered.has(input.fastModel)) {
      throw invalidModel(input.fastModel, baseUrl);
    }
    if (input.smartModel != null && !offered.has(input.smartModel)) {
      throw invalidModel(input.smartModel, baseUrl);
    }

    if (!credentialsTouched) return input;

    const patch: AgentConfigPatch = { ...input };
    if (input.fastModel === undefined && !offered.has(before.fastModel)) {
      const replacement = fastModelFor(baseUrl, offered);
      if (replacement) {
        patch.fastModel = replacement;
        this.log.log(
          `${id}: fastModel ${before.fastModel} is not offered by ${baseUrl} — reset to ${replacement}`,
        );
      }
    }
    if (
      input.smartModel === undefined &&
      before.smartModel != null &&
      !offered.has(before.smartModel)
    ) {
      patch.smartModel = null;
      this.log.log(
        `${id}: smartModel ${before.smartModel} is not offered by ${baseUrl} — cleared`,
      );
    }
    return patch;
  }

  private async offeredModels(
    id: string,
    baseUrl: string,
    apiKey: string,
  ): Promise<Set<string> | null> {
    const listed = await this.models.listForProvider(id, baseUrl, apiKey).catch((err: unknown) => {
      this.log.warn(`model list for ${baseUrl} failed: ${describe(err)}`);
      return null;
    });
    if (!listed?.supported || listed.models.length === 0) return null;
    return new Set(listed.models.map((m) => m.id));
  }
}

function invalidModel(model: string, baseUrl: string): BadRequestException {
  return new BadRequestException({
    message: `agent_config_invalid_model: ${model} is not offered by ${baseUrl}`,
    code: 'agent_config_invalid_model',
  });
}

function fastModelFor(baseUrl: string, offered: Set<string>): string | null {
  const preset = defaultFastModelForBaseUrl(baseUrl);
  if (preset && offered.has(preset)) return preset;
  return offered.values().next().value ?? null;
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
