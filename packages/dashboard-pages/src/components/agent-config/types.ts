import type { ReactNode } from 'react';

export interface AgentConfigDto {
  id: string;
  fastModel: string;
  smartModel: string | null;
  providerBaseUrl: string;
  providerApiKeySet: boolean;
  maxHistoryChars: number;
  maxToolIterations: number;
  debounceMs: number;
}

export interface ModelEntry {
  id: string;
  contextLength: number | null;
  promptCostPerMillion: number | null;
  completionCostPerMillion: number | null;
}

export interface ListModelsResult {
  supported: boolean;
  models: ModelEntry[];
}

export interface UpsertBody {
  providerBaseUrl?: string;
  providerApiKey?: string | null;
  fastModel?: string;
  smartModel?: string | null;
}

export interface ProviderPreset {
  id: string;
  name: string;
  url: string;
  /** When true, the preset uses no host credentials; selecting it clears the org key. */
  managed?: boolean;
  /** Host-supplied content shown in place of the URL/key inputs for a managed preset. */
  description?: ReactNode;
}

export const PROVIDER_PRESETS = [
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { id: 'anthropic', name: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { id: 'custom', name: 'Custom', url: '' },
] as const;

export type PresetId = (typeof PROVIDER_PRESETS)[number]['id'];

export function presetForUrl(url: string): PresetId {
  const match = PROVIDER_PRESETS.find((p) => p.url === url);
  return match?.id ?? 'custom';
}

export function formatModel(m: ModelEntry): string {
  const parts: string[] = [m.id];
  if (m.contextLength) parts.push(`${(m.contextLength / 1000).toFixed(0)}k ctx`);
  if (m.promptCostPerMillion !== null) {
    parts.push(`$${m.promptCostPerMillion.toFixed(2)}/M in`);
  }
  if (m.completionCostPerMillion !== null) {
    parts.push(`$${m.completionCostPerMillion.toFixed(2)}/M out`);
  }
  return parts.join(' · ');
}
