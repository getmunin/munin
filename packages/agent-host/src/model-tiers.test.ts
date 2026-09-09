import { describe, expect, it } from 'vitest';
import { resolveModelTiers } from './runner.service.ts';

describe('resolveModelTiers', () => {
  it('keeps the org config models when the provider offers no list of its own', () => {
    const tiers = resolveModelTiers(
      { apiKey: 'sk-x', managed: false },
      { fastModel: 'claude-haiku-4-5', smartModel: 'claude-opus-5' },
    );
    expect(tiers).toEqual({ fastModel: 'claude-haiku-4-5', smartModel: 'claude-opus-5' });
  });

  it('runs both tiers on the fast model when the org set no smart model', () => {
    const tiers = resolveModelTiers(
      { apiKey: 'sk-x', managed: false },
      { fastModel: 'claude-haiku-4-5', smartModel: null },
    );
    expect(tiers).toEqual({ fastModel: 'claude-haiku-4-5', smartModel: 'claude-haiku-4-5' });
  });

  it('pins both tiers when the managed provider offers exactly one model', () => {
    const tiers = resolveModelTiers(
      { apiKey: 'sk-x', models: ['gpt-oss-120b'], managed: true },
      { fastModel: 'claude-haiku-4-5', smartModel: 'claude-opus-5' },
    );
    expect(tiers).toEqual({ fastModel: 'gpt-oss-120b', smartModel: 'gpt-oss-120b' });
  });

  it('honours the org fast and smart choice when the managed provider offers both', () => {
    const tiers = resolveModelTiers(
      {
        apiKey: 'sk-x',
        models: ['gpt-oss-120b', 'gemma-4-26b-a4b-it', 'qwen3.5-397b-a17b'],
        managed: true,
      },
      { fastModel: 'gemma-4-26b-a4b-it', smartModel: 'qwen3.5-397b-a17b' },
    );
    expect(tiers).toEqual({
      fastModel: 'gemma-4-26b-a4b-it',
      smartModel: 'qwen3.5-397b-a17b',
    });
  });

  it('falls back to the first offered model when the org picked one no longer offered', () => {
    const tiers = resolveModelTiers(
      { apiKey: 'sk-x', models: ['gpt-oss-120b', 'gemma-4-26b-a4b-it'], managed: true },
      { fastModel: 'retired-model', smartModel: null },
    );
    expect(tiers).toEqual({ fastModel: 'gpt-oss-120b', smartModel: 'gpt-oss-120b' });
  });

  it('drops a smart model outside the offered list back onto the fast tier', () => {
    const tiers = resolveModelTiers(
      { apiKey: 'sk-x', models: ['gpt-oss-120b', 'gemma-4-26b-a4b-it'], managed: true },
      { fastModel: 'gemma-4-26b-a4b-it', smartModel: 'qwen3.5-397b-a17b' },
    );
    expect(tiers).toEqual({
      fastModel: 'gemma-4-26b-a4b-it',
      smartModel: 'gemma-4-26b-a4b-it',
    });
  });
});
