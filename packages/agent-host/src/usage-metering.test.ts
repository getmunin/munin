import { describe, it, expect, vi } from 'vitest';
import type { Provider, ProviderCallArgs, ProviderResponse } from '@getmunin/agent-runtime';
import { createMeteringProvider } from './usage-metering.ts';

const ARGS: ProviderCallArgs = {
  config: {
    provider: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test' },
    model: 'test-model',
    systemPrompt: 'you are a test',
  },
  messages: [],
  tools: [],
};

function response(usage?: ProviderResponse['usage']): ProviderResponse {
  return { message: { role: 'assistant', content: 'hi' }, finishReason: 'stop', usage };
}

describe('createMeteringProvider', () => {
  it('reports total tokens from the provider response', async () => {
    const base: Provider = vi.fn().mockResolvedValue(response({ total_tokens: 1234 }));
    const onTokens = vi.fn();

    await createMeteringProvider(base, onTokens)(ARGS);

    expect(onTokens).toHaveBeenCalledExactlyOnceWith(1234);
  });

  it('returns the underlying response unchanged', async () => {
    const out = response({ total_tokens: 10 });
    const provider = createMeteringProvider(vi.fn().mockResolvedValue(out), vi.fn());

    expect(await provider(ARGS)).toBe(out);
  });

  it('does not report when usage is absent or zero', async () => {
    const onTokens = vi.fn();

    await createMeteringProvider(vi.fn().mockResolvedValue(response()), onTokens)(ARGS);
    await createMeteringProvider(
      vi.fn().mockResolvedValue(response({ total_tokens: 0 })),
      onTokens,
    )(ARGS);

    expect(onTokens).not.toHaveBeenCalled();
  });

  it('propagates provider errors without reporting', async () => {
    const onTokens = vi.fn();
    const base: Provider = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(createMeteringProvider(base, onTokens)(ARGS)).rejects.toThrow('boom');
    expect(onTokens).not.toHaveBeenCalled();
  });
});
