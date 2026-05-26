import { describe, it, expect } from 'vitest';
import {
  shouldEnablePromptCache,
  withSystemPromptCache,
  withToolsCache,
} from './openai-compatible.ts';
import type { ChatMessage, ChatToolDefinition } from '../types.ts';

import { vi } from 'vitest';
import { openAiCompatibleProvider } from './openai-compatible.ts';

describe('openAiCompatibleProvider request body', () => {
  it('emits cache_control on system + last tool when targeting Anthropic', async () => {
    const captured: { url?: string; body?: Record<string, unknown> } = {};
    const fakeFetch = vi.fn((url: string, init: RequestInit) => {
      captured.url = url;
      captured.body = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
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
    } finally {
      globalThis.fetch = originalFetch;
    }

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
    const fakeFetch = vi.fn((_url: string, init: RequestInit) => {
      captured.body = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
      await openAiCompatibleProvider({
        config: {
          provider: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-xxx' },
          model: 'gpt-4o-mini',
          systemPrompt: 'sys',
        },
        messages: [{ role: 'system', content: 'sys' }],
        tools: [{ type: 'function', function: { name: 'a', description: 'a', parameters: {} } }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const messages = captured.body?.messages as Array<{ content: unknown }>;
    expect(messages[0]?.content).toBe('sys');
    const tools = captured.body?.tools as Array<Record<string, unknown>>;
    expect(tools[0]?.cache_control).toBeUndefined();
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
