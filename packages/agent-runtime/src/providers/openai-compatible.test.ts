import { afterEach, describe, it, expect, vi } from 'vitest';
import * as core from '@getmunin/core';
import {
  parseRetryAfterMs,
  rateLimitRetryDelayMs,
  shouldEnablePromptCache,
  withSystemPromptCache,
  withToolsCache,
} from './openai-compatible.ts';
import type { ChatMessage, ChatToolDefinition } from '../types.ts';

import { openAiCompatibleProvider } from './openai-compatible.ts';

function stubSafeFetch(
  handler: (url: string, init: { body?: unknown }) => { status?: number; body: unknown },
): ReturnType<typeof vi.fn> {
  const fn = vi.fn((url: string, init: { body?: unknown }) => {
    const out = handler(url, init);
    const status = out.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(out.body),
      text: () => Promise.resolve(typeof out.body === 'string' ? out.body : JSON.stringify(out.body)),
    });
  });
  vi.spyOn(core, 'safeFetch').mockImplementation(fn as unknown as typeof core.safeFetch);
  return fn;
}

describe('openAiCompatibleProvider request body', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits cache_control on system + last tool when targeting Anthropic', async () => {
    const captured: { url?: string; body?: Record<string, unknown> } = {};
    stubSafeFetch((url, init) => {
      captured.url = url;
      captured.body = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        body: {
          choices: [
            { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      };
    });

    await openAiCompatibleProvider({
      config: {
        provider: { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-xxx' },
        model: 'claude-haiku-4-5',
        systemPrompt: 'sys',
      },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        { type: 'function', function: { name: 'a', description: 'a', parameters: {} } },
        { type: 'function', function: { name: 'b', description: 'b', parameters: {} } },
      ],
    });

    const messages = captured.body?.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]?.content).toEqual([
      { type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } },
    ]);
    expect(messages[1]).toEqual({ role: 'user', content: 'hi' });
    const tools = captured.body?.tools as Array<Record<string, unknown>>;
    expect(tools[0]?.cache_control).toBeUndefined();
    expect(tools[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does NOT emit cache_control on plain OpenAI backend', async () => {
    const captured: { body?: Record<string, unknown> } = {};
    stubSafeFetch((_url, init) => {
      captured.body = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        body: {
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        },
      };
    });

    await openAiCompatibleProvider({
      config: {
        provider: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-xxx' },
        model: 'gpt-4o-mini',
        systemPrompt: 'sys',
      },
      messages: [{ role: 'system', content: 'sys' }],
      tools: [{ type: 'function', function: { name: 'a', description: 'a', parameters: {} } }],
    });

    const messages = captured.body?.messages as Array<{ content: unknown }>;
    expect(messages[0]?.content).toBe('sys');
    const tools = captured.body?.tools as Array<Record<string, unknown>>;
    expect(tools[0]?.cache_control).toBeUndefined();
  });
});

describe('openAiCompatibleProvider rate-limit retries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function stubSafeFetchSequence(
    responses: Array<{ status: number; body: unknown; retryAfter?: string }>,
  ): ReturnType<typeof vi.fn> {
    let call = 0;
    const fn = vi.fn(() => {
      const out = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return Promise.resolve({
        ok: out.status >= 200 && out.status < 300,
        status: out.status,
        headers: { get: (name: string) => (name === 'retry-after' ? (out.retryAfter ?? null) : null) },
        json: () => Promise.resolve(out.body),
        text: () =>
          Promise.resolve(typeof out.body === 'string' ? out.body : JSON.stringify(out.body)),
      });
    });
    vi.spyOn(core, 'safeFetch').mockImplementation(fn as unknown as typeof core.safeFetch);
    return fn;
  }

  const okBody = {
    choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  const call = (): Promise<unknown> =>
    openAiCompatibleProvider({
      config: {
        provider: { baseUrl: 'https://api.scaleway.ai/v1', apiKey: 'k' },
        model: 'gpt-oss-120b',
        systemPrompt: 'sys',
      },
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });

  it('retries a 429 and resolves without surfacing a provider error', async () => {
    vi.useFakeTimers();
    const fetchStub = stubSafeFetchSequence([
      { status: 429, body: { error: 'INSUFFICIENT QUOTA' }, retryAfter: '1' },
      { status: 200, body: okBody },
    ]);

    const pending = call();
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toMatchObject({ finishReason: 'stop' });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and throws provider_rate_limit', async () => {
    vi.useFakeTimers();
    const fetchStub = stubSafeFetchSequence([
      { status: 429, body: { error: 'INSUFFICIENT QUOTA' } },
    ]);

    const pending = call().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(120_000);

    const err = await pending;
    expect(err).toMatchObject({ name: 'ProviderError', code: 'provider_rate_limit', status: 429 });
    expect(fetchStub).toHaveBeenCalledTimes(5);
  });

  it('does not retry a non-429 failure', async () => {
    const fetchStub = stubSafeFetchSequence([{ status: 401, body: { error: 'User not found.' } }]);

    const err = await call().catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'ProviderError', code: 'provider_auth' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe('rateLimitRetryDelayMs', () => {
  it('grows exponentially across attempts', () => {
    const half = (): number => 0;
    expect(rateLimitRetryDelayMs(null, 0, half)).toBe(500);
    expect(rateLimitRetryDelayMs(null, 1, half)).toBe(1_000);
    expect(rateLimitRetryDelayMs(null, 2, half)).toBe(2_000);
  });

  it('jitters so that concurrent callers do not retry in lockstep', () => {
    expect(rateLimitRetryDelayMs(null, 0, () => 0)).toBe(500);
    expect(rateLimitRetryDelayMs(null, 0, () => 1)).toBe(1_000);
  });

  it('never waits less than the provider asked for', () => {
    expect(rateLimitRetryDelayMs('3', 0, () => 0)).toBe(3_000);
  });

  it('caps the wait', () => {
    expect(rateLimitRetryDelayMs('600', 4, () => 1)).toBe(15_000);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2_000);
  });

  it('reads an HTTP date', () => {
    const at = new Date(Date.now() + 4_000).toUTCString();
    const ms = parseRetryAfterMs(at);
    expect(ms).toBeGreaterThan(2_000);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it('returns null for a missing or unparseable header', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

describe('shouldEnablePromptCache', () => {
  it('auto-enables for Anthropic native endpoint', () => {
    expect(
      shouldEnablePromptCache({
        provider: { baseUrl: 'https://api.anthropic.com/v1' },
        model: 'claude-haiku-4-5',
      }),
    ).toBe(true);
  });

  it('auto-enables for OpenRouter with anthropic/* model', () => {
    expect(
      shouldEnablePromptCache({
        provider: { baseUrl: 'https://openrouter.ai/api/v1' },
        model: 'anthropic/claude-haiku-4.5',
      }),
    ).toBe(true);
  });

  it('does not auto-enable for OpenRouter with non-anthropic model', () => {
    expect(
      shouldEnablePromptCache({
        provider: { baseUrl: 'https://openrouter.ai/api/v1' },
        model: 'openai/gpt-4o-mini',
      }),
    ).toBe(false);
  });

  it('does not auto-enable for OpenAI', () => {
    expect(
      shouldEnablePromptCache({
        provider: { baseUrl: 'https://api.openai.com/v1' },
        model: 'gpt-4o-mini',
      }),
    ).toBe(false);
  });

  it('explicit false overrides auto-detection', () => {
    expect(
      shouldEnablePromptCache({
        provider: { baseUrl: 'https://api.anthropic.com/v1' },
        model: 'claude-haiku-4-5',
        enablePromptCache: false,
      }),
    ).toBe(false);
  });

  it('explicit true forces caching even on non-Anthropic backend', () => {
    expect(
      shouldEnablePromptCache({
        provider: { baseUrl: 'https://api.openai.com/v1' },
        model: 'gpt-4o-mini',
        enablePromptCache: true,
      }),
    ).toBe(true);
  });
});

describe('withSystemPromptCache', () => {
  it('wraps the first system message content in a cache_control block', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'hi' },
    ];
    const result = withSystemPromptCache(messages) as Array<{ role: string; content: unknown }>;
    expect(result[0]?.role).toBe('system');
    expect(result[0]?.content).toEqual([
      { type: 'text', text: 'You are a helpful assistant.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(result[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('marks only the first system message when there are multiple', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'first' },
      { role: 'user', content: 'q' },
      { role: 'system', content: 'second' },
    ];
    const result = withSystemPromptCache(messages) as Array<{ role: string; content: unknown }>;
    expect(Array.isArray(result[0]?.content)).toBe(true);
    expect(result[2]?.content).toBe('second');
  });

  it('passes through when there is no system message', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    expect(withSystemPromptCache(messages)).toEqual(messages);
  });

  it('passes through when system content is empty', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: 'hi' },
    ];
    expect(withSystemPromptCache(messages)).toEqual(messages);
  });
});

describe('withToolsCache', () => {
  it('marks the last tool with cache_control', () => {
    const tools: ChatToolDefinition[] = [
      { type: 'function', function: { name: 'a', description: 'a', parameters: {} } },
      { type: 'function', function: { name: 'b', description: 'b', parameters: {} } },
    ];
    const result = withToolsCache(tools) as Array<Record<string, unknown>>;
    expect(result[0]).toEqual(tools[0]);
    expect(result[1]).toEqual({ ...tools[1], cache_control: { type: 'ephemeral' } });
  });

  it('marks the only tool when length is 1', () => {
    const tools: ChatToolDefinition[] = [
      { type: 'function', function: { name: 'a', description: 'a', parameters: {} } },
    ];
    const result = withToolsCache(tools) as Array<Record<string, unknown>>;
    expect(result[0]).toEqual({ ...tools[0], cache_control: { type: 'ephemeral' } });
  });

  it('returns the same array when there are no tools', () => {
    expect(withToolsCache([])).toEqual([]);
  });
});
