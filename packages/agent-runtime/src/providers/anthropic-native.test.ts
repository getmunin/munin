import { afterEach, describe, it, expect, vi } from 'vitest';
import * as core from '@getmunin/core';
import {
  anthropicNativeProvider,
  isAnthropicNativeBaseUrl,
  fromNativeContent,
  toNativeMessages,
  toNativeSystem,
  toNativeTools,
  toProviderUsage,
} from './anthropic-native.ts';
import { selectProvider } from './default-provider.ts';
import { openAiCompatibleProvider } from './openai-compatible.ts';
import type { ChatMessage, ChatToolCall, ChatToolDefinition } from '../types.ts';

interface CapturedRequest {
  url?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

function stubSafeFetch(
  captured: CapturedRequest,
  response: unknown,
  status = 200,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    (url: string, init: { body?: unknown; headers?: Record<string, string> }) => {
      captured.url = url;
      captured.headers = init.headers;
      captured.body = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(response),
        text: () =>
          Promise.resolve(
            typeof response === 'string' ? response : JSON.stringify(response),
          ),
      });
    },
  );
  vi.spyOn(core, 'safeFetch').mockImplementation(fn as unknown as typeof core.safeFetch);
  return fn;
}

const okResponse = {
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 3 },
};

function call(
  overrides: Partial<Parameters<typeof anthropicNativeProvider>[0]> = {},
): Promise<unknown> {
  return anthropicNativeProvider({
    config: {
      provider: { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-xxx' },
      model: 'claude-haiku-4-5',
      systemPrompt: 'sys',
    },
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ],
    tools: [],
    ...overrides,
  });
}

describe('provider selection', () => {
  it('routes api.anthropic.com to the native provider so cache_control is honoured', () => {
    expect(selectProvider('https://api.anthropic.com/v1')).toBe(anthropicNativeProvider);
    expect(isAnthropicNativeBaseUrl('https://api.anthropic.com/v1/')).toBe(true);
  });

  it('routes every other backend to the OpenAI-compatible provider', () => {
    expect(selectProvider('https://openrouter.ai/api/v1')).toBe(openAiCompatibleProvider);
    expect(selectProvider('https://api.openai.com/v1')).toBe(openAiCompatibleProvider);
  });
});

describe('anthropicNativeProvider request', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to /messages with the native auth and version headers', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, okResponse);

    await call();

    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured.headers).toMatchObject({
      'x-api-key': 'sk-ant-xxx',
      'anthropic-version': '2023-06-01',
    });
    expect(captured.headers?.authorization).toBeUndefined();
  });

  it('always sends max_tokens, which the native API requires', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, okResponse);

    await call();

    expect(captured.body?.max_tokens).toBe(8192);
  });

  it('prefers a configured max_tokens over the default', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, okResponse);

    await call({
      config: {
        provider: { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' },
        model: 'claude-haiku-4-5',
        systemPrompt: 'sys',
        maxTokens: 1234,
      },
    });

    expect(captured.body?.max_tokens).toBe(1234);
  });

  it('hoists system messages out of the messages array into system blocks', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, okResponse);

    await call({
      messages: [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'user', content: 'hi' },
      ],
    });

    const system = captured.body?.system as Array<Record<string, unknown>>;
    expect(system).toHaveLength(2);
    expect(system[0]).toEqual({ type: 'text', text: 'first' });
    const messages = captured.body?.messages as Array<{ role: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
  });

  it('omits system and tools when there are none', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, okResponse);

    await call({ messages: [{ role: 'user', content: 'hi' }], tools: [] });

    expect(captured.body).not.toHaveProperty('system');
    expect(captured.body).not.toHaveProperty('tools');
  });

  it('drops response_format, which the native API does not accept', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, okResponse);

    await call({
      config: {
        provider: { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' },
        model: 'claude-haiku-4-5',
        systemPrompt: 'sys',
        responseFormat: 'json_object',
      },
    });

    expect(captured.body).not.toHaveProperty('response_format');
  });

  it('surfaces a non-2xx response as a classified ProviderError', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, { error: 'invalid x-api-key' }, 401);

    const err = await call().catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'ProviderError', code: 'provider_auth', status: 401 });
  });
});

describe('cache breakpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caches the tools+system prefix for an hour and the turn prefix for five minutes', async () => {
    const captured: CapturedRequest = {};
    stubSafeFetch(captured, okResponse);

    await call({
      messages: [
        { role: 'system', content: 'stable' },
        { role: 'system', content: 'note' },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        { type: 'function', function: { name: 'a', description: 'a', parameters: {} } },
        { type: 'function', function: { name: 'b', description: 'b', parameters: {} } },
      ],
    });

    const system = captured.body?.system as Array<Record<string, unknown>>;
    expect(system[0]?.cache_control).toBeUndefined();
    expect(system[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    const tools = captured.body?.tools as Array<Record<string, unknown>>;
    expect(tools[0]?.cache_control).toBeUndefined();
    expect(tools[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    const messages = captured.body?.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(messages[0]?.content[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('breaks after the last stable system block so volatile context stays outside the prefix', () => {
    const blocks = toNativeSystem([
      { role: 'system', content: 'org prompt' },
      { role: 'system', content: 'untrusted-data note' },
      { role: 'system', content: 'conversationId: conv_1', volatile: true },
    ]) as Array<Record<string, unknown>>;

    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(blocks[2]?.cache_control).toBeUndefined();
    expect(blocks[2]?.text).toBe('conversationId: conv_1');
  });

  it('skips the system breakpoint entirely when every block is volatile', () => {
    const blocks = toNativeSystem([
      { role: 'system', content: 'conversationId: conv_1', volatile: true },
    ]) as Array<Record<string, unknown>>;

    expect(blocks[0]?.cache_control).toBeUndefined();
  });

  it('moves the turn breakpoint to the newest tool results so the next iteration reads them', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'kb_search')] },
      { role: 'tool', tool_call_id: 'c1', content: 'docs' },
    ];

    const native = toNativeMessages(messages);

    expect(native).toHaveLength(3);
    const first = native[0]?.content[0] as Record<string, unknown>;
    expect(first.cache_control).toBeUndefined();
    const last = native[2]?.content[0] as Record<string, unknown>;
    expect(last.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('never marks a signed thinking block, which must be echoed back byte-for-byte', () => {
    const native = toNativeMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        providerContentBlocks: [{ type: 'thinking', thinking: '', signature: 'sig' }],
      },
    ]);

    expect(native[1]?.content).toEqual([
      { type: 'thinking', thinking: '', signature: 'sig' },
    ]);
  });

  it('emits no cache_control when caching is explicitly disabled', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    const tools: ChatToolDefinition[] = [
      { type: 'function', function: { name: 'a', parameters: {} } },
    ];

    expect(toNativeSystem(messages, false)).toEqual([{ type: 'text', text: 'sys' }]);
    expect(toNativeTools(tools, false)).toEqual([{ name: 'a', input_schema: {} }]);
    const native = toNativeMessages(messages, false);
    expect(native[0]?.content[0]).toEqual({ type: 'text', text: 'hi' });
  });
});

describe('toNativeMessages', () => {
  it('translates an assistant tool call into a tool_use block', () => {
    const native = toNativeMessages(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'let me look',
          tool_calls: [toolCall('c1', 'kb_search', '{"q":"pricing"}')],
        },
      ],
      false,
    );

    expect(native[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', id: 'c1', name: 'kb_search', input: { q: 'pricing' } },
      ],
    });
  });

  it('merges parallel tool results into one user message', () => {
    const native = toNativeMessages(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall('c1', 'a'), toolCall('c2', 'b')],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'r1' },
        { role: 'tool', tool_call_id: 'c2', content: 'r2' },
      ],
      false,
    );

    expect(native).toHaveLength(3);
    expect(native[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: 'r1' },
        { type: 'tool_result', tool_use_id: 'c2', content: 'r2' },
      ],
    });
  });

  it('echoes an assistant turn back verbatim so thinking blocks keep their signatures', () => {
    const blocks = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'tool_use', id: 'c1', name: 'kb_search', input: {} },
    ];
    const native = toNativeMessages(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall('c1', 'kb_search')],
          providerContentBlocks: blocks,
        },
      ],
      false,
    );

    expect(native[1]?.content).toEqual(blocks);
  });

  it('prepends a user turn when history opens with an assistant message', () => {
    const native = toNativeMessages(
      [{ role: 'assistant', content: 'we emailed you earlier' }],
      false,
    );

    expect(native[0]?.role).toBe('user');
    expect(native).toHaveLength(2);
    expect(native[1]?.role).toBe('assistant');
  });

  it('skips empty messages, which the native API rejects as empty content', () => {
    const native = toNativeMessages(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '' },
        { role: 'user', content: '' },
      ],
      false,
    );

    expect(native).toHaveLength(1);
    expect(native[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
  });
});

describe('fromNativeContent', () => {
  it('splits text and tool_use blocks, ignoring thinking blocks', () => {
    const { text, toolCalls } = fromNativeContent([
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'checking' },
      { type: 'tool_use', id: 'c1', name: 'kb_search', input: { q: 'x' } },
    ]);

    expect(text).toBe('checking');
    expect(toolCalls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'kb_search', arguments: '{"q":"x"}' } },
    ]);
  });

  it('returns empty text when the turn is only tool calls', () => {
    const { text, toolCalls } = fromNativeContent([
      { type: 'tool_use', id: 'c1', name: 'a', input: {} },
    ]);

    expect(text).toBe('');
    expect(toolCalls).toHaveLength(1);
  });
});

describe('anthropicNativeProvider response', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports tool_calls and keeps the raw blocks for the next request', async () => {
    const captured: CapturedRequest = {};
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'c1', name: 'kb_search', input: { q: 'x' } },
    ];
    stubSafeFetch(captured, { content, stop_reason: 'tool_use', usage: {} });

    const res = (await call()) as {
      finishReason: string;
      message: ChatMessage;
    };

    expect(res.finishReason).toBe('tool_calls');
    expect(res.message.tool_calls).toHaveLength(1);
    expect(res.message.providerContentBlocks).toEqual(content);
  });

  it('maps stop reasons onto the runtime finish reasons', async () => {
    const cases: Array<[string, string]> = [
      ['end_turn', 'stop'],
      ['stop_sequence', 'stop'],
      ['max_tokens', 'length'],
      ['refusal', 'error'],
    ];
    for (const [stopReason, expected] of cases) {
      const captured: CapturedRequest = {};
      stubSafeFetch(captured, {
        content: [{ type: 'text', text: 'x' }],
        stop_reason: stopReason,
      });
      const res = (await call()) as { finishReason: string };
      expect(res.finishReason).toBe(expected);
      vi.restoreAllMocks();
    }
  });
});

describe('toProviderUsage', () => {
  it('counts cached tokens as prompt tokens so metering sees the whole prompt', () => {
    expect(
      toProviderUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 50,
      }),
    ).toEqual({
      prompt_tokens: 950,
      completion_tokens: 20,
      total_tokens: 970,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 50,
    });
  });

  it('defaults the cache counters to zero when the response omits them', () => {
    expect(toProviderUsage({ input_tokens: 5, output_tokens: 1 })).toEqual({
      prompt_tokens: 5,
      completion_tokens: 1,
      total_tokens: 6,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });

  it('passes through an absent usage object', () => {
    expect(toProviderUsage(undefined)).toBeUndefined();
  });
});

function toolCall(id: string, name: string, args = '{}'): ChatToolCall {
  return { id, type: 'function', function: { name, arguments: args } };
}
