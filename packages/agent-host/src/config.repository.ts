export interface AgentConfigRow {
  id: string;
  enabled: boolean;
  chatModel: string;
  curatorModel: string | null;
  providerBaseUrl: string;
  providerApiKeySet: boolean;
  maxHistoryChars: number;
  maxToolIterations: number;
  debounceMs: number;
  adminApiKeyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfigPatch {
  enabled?: boolean;
  chatModel?: string;
  curatorModel?: string | null;
  providerBaseUrl?: string;
  providerApiKey?: string | null;
  maxHistoryChars?: number;
  maxToolIterations?: number;
  debounceMs?: number;
}

export interface AgentConfigRepository {
  resolveCurrentId(): string;
  read(id: string): Promise<AgentConfigRow>;
  update(id: string, patch: AgentConfigPatch): Promise<AgentConfigRow>;
  listEnabledIds(): Promise<string[]>;
  readDecryptedProviderKey(id: string): Promise<string | null>;
  readDecryptedAdminKey(id: string): Promise<string | null>;
}
