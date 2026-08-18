import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LLM_FAST_MODEL,
  DEFAULT_LLM_PROVIDER_BASE_URL,
  defaultFastModelForBaseUrl,
  llmProviderPresetForBaseUrl,
} from './llm-providers.ts';

describe('llmProviderPresetForBaseUrl', () => {
  it('matches a preset regardless of trailing slash, path or scheme casing', () => {
    expect(llmProviderPresetForBaseUrl('https://api.anthropic.com/v1')?.id).toBe('anthropic');
    expect(llmProviderPresetForBaseUrl('https://api.anthropic.com/v1/')?.id).toBe('anthropic');
    expect(llmProviderPresetForBaseUrl('HTTPS://API.Anthropic.COM/v1')?.id).toBe('anthropic');
    expect(llmProviderPresetForBaseUrl('https://openrouter.ai/api/v1')?.id).toBe('openrouter');
  });

  it('returns null for unknown hosts and unparseable input', () => {
    expect(llmProviderPresetForBaseUrl('https://llm.internal.example/v1')).toBeNull();
    expect(llmProviderPresetForBaseUrl('not a url')).toBeNull();
    expect(llmProviderPresetForBaseUrl('')).toBeNull();
  });
});

describe('defaultFastModelForBaseUrl', () => {
  it('returns the provider-shaped model id for each known provider', () => {
    expect(defaultFastModelForBaseUrl('https://openrouter.ai/api/v1')).toBe(
      'anthropic/claude-haiku-4.5',
    );
    expect(defaultFastModelForBaseUrl('https://api.anthropic.com/v1')).toBe('claude-haiku-4-5');
  });

  it('returns null when the provider has no known default', () => {
    expect(defaultFastModelForBaseUrl('https://api.openai.com/v1')).toBeNull();
    expect(defaultFastModelForBaseUrl('https://llm.internal.example/v1')).toBeNull();
  });
});

describe('workspace defaults', () => {
  it('resolve to the default provider preset', () => {
    expect(DEFAULT_LLM_PROVIDER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(DEFAULT_LLM_FAST_MODEL).toBe('anthropic/claude-haiku-4.5');
    expect(defaultFastModelForBaseUrl(DEFAULT_LLM_PROVIDER_BASE_URL)).toBe(DEFAULT_LLM_FAST_MODEL);
  });
});
