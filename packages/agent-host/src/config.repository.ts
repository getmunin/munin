export interface AgentConfigRow {
  id: string;
  fastModel: string;
  smartModel: string | null;
  providerBaseUrl: string;
  providerApiKeySet: boolean;
  maxHistoryChars: number;
  maxToolIterations: number;
  debounceMs: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfigPatch {
  fastModel?: string;
  smartModel?: string | null;
  providerBaseUrl?: string;
  providerApiKey?: string | null;
  maxHistoryChars?: number;
  maxToolIterations?: number;
  debounceMs?: number;
}

export interface AgentConfigRepository {
  resolveCurrentId(): string;
  resolveOrgId(id: string): Promise<string>;
  read(id: string): Promise<AgentConfigRow>;
  update(id: string, patch: AgentConfigPatch): Promise<AgentConfigRow>;
  listProvisionedIds(): Promise<string[]>;
  readDecryptedProviderKey(id: string): Promise<string | null>;
}
