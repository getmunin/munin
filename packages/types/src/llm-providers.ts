export interface LlmProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  defaultFastModel: string | null;
}

export const LLM_PROVIDER_PRESETS: readonly LlmProviderPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultFastModel: 'anthropic/claude-haiku-4.5',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultFastModel: 'claude-haiku-4-5',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultFastModel: null,
  },
];

export const DEFAULT_LLM_PROVIDER_ID = 'openrouter';

export function llmProviderPresetForBaseUrl(baseUrl: string): LlmProviderPreset | null {
  const host = hostOf(baseUrl);
  if (!host) return null;
  return LLM_PROVIDER_PRESETS.find((preset) => hostOf(preset.baseUrl) === host) ?? null;
}

export function llmProviderPreset(id: string): LlmProviderPreset | null {
  return LLM_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function defaultFastModelForBaseUrl(baseUrl: string): string | null {
  return llmProviderPresetForBaseUrl(baseUrl)?.defaultFastModel ?? null;
}

export const DEFAULT_LLM_PROVIDER_BASE_URL =
  llmProviderPreset(DEFAULT_LLM_PROVIDER_ID)?.baseUrl ?? 'https://openrouter.ai/api/v1';

export const DEFAULT_LLM_FAST_MODEL =
  llmProviderPreset(DEFAULT_LLM_PROVIDER_ID)?.defaultFastModel ?? 'anthropic/claude-haiku-4.5';

function hostOf(raw: string): string | null {
  const schemeEnd = raw.trim().indexOf('://');
  if (schemeEnd <= 0) return null;
  const authority = raw.trim().slice(schemeEnd + 3).split(/[/?#]/)[0] ?? '';
  const credentialsEnd = authority.lastIndexOf('@');
  const hostPort = credentialsEnd >= 0 ? authority.slice(credentialsEnd + 1) : authority;
  return hostPort.length > 0 ? hostPort.toLowerCase() : null;
}
