import { Inject, Injectable } from '@nestjs/common';
import { AGENT_CONFIG_REPOSITORY, ADMIN_KEY_PROVIDER } from './injection-tokens.js';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.js';
import type { AdminKeyProvider } from './admin-key-provider.js';

export interface AgentConfigDto {
  id: string;
  enabled: boolean;
  chatModel: string;
  curatorModel: string | null;
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
  ) {}

  async getForCurrentActor(): Promise<AgentConfigDto> {
    const id = this.repo.resolveCurrentId();
    const row = await this.repo.read(id);
    return toDto(row);
  }

  async upsertForCurrentActor(input: AgentConfigPatch): Promise<AgentConfigDto> {
    const id = this.repo.resolveCurrentId();
    const before = await this.repo.read(id);
    const after = await this.repo.update(id, input);

    if (input.enabled === true && !before.adminApiKeyId) {
      await this.adminKey.mint(id);
    } else if (input.enabled === false && before.adminApiKeyId) {
      await this.adminKey.revoke(id, before.adminApiKeyId);
    }

    return toDto(after);
  }
}

function toDto(row: AgentConfigRow): AgentConfigDto {
  return {
    id: row.id,
    enabled: row.enabled,
    chatModel: row.chatModel,
    curatorModel: row.curatorModel,
    providerBaseUrl: row.providerBaseUrl,
    providerApiKeySet: row.providerApiKeySet,
    maxHistoryChars: row.maxHistoryChars,
    maxToolIterations: row.maxToolIterations,
    debounceMs: row.debounceMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
