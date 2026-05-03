import { describe, expect, it, vi } from 'vitest';
import { runAgent } from './runtime.js';
import { createStubProvider } from './providers/stub.js';
import type {
  AgentConfig,
  ConversationMessage,
  McpToolHandle,
  ProviderResponse,
} from './types.js';

const baseConfig: AgentConfig = {
  provider: { baseUrl: 'http://stub', apiKey: 'stub' },
  model: 'stub-model',
  systemPrompt: 'You are a helpful self-service assistant.',
};

function makeMcp(overrides: Partial<McpToolHandle> = {}): McpToolHandle {
  return {
    listTools: vi.fn(() =>
      Promise.resolve([
        {
          name: 'kb_search',
          description: 'Search the knowledge base.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ]),
    ),
    callTool: vi.fn(() =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'kb result: hours 9-5' }],
      }),
    ),
    ...overrides,
  };
}

function plainTextResponse(content: string): ProviderResponse {
  return {
    message: { role: 'assistant', content },
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    finishReason: 'stop',
  };
}

function toolCallResponse(callId: string, toolName: string, args: Record<string, unknown>): ProviderResponse {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: callId,
          type: 'function',
          function: { name: toolName, arguments: JSON.stringify(args) },
        },
      ],
    },
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    finishReason: 'tool_calls',
  };
}

describe('runAgent', () => {
  it('returns assistant content directly when no tool calls are made', async () => {
    const { provider, calls } = createStubProvider({
      responses: [plainTextResponse('Hello there!')],
    });

    const reply = await runAgent({
      config: baseConfig,
      history: [{ authorType: 'end_user', body: 'hi' }],
      mcp: makeMcp(),
      provider,
    });

    expect(reply.body).toBe('Hello there!');
    expect(reply.finishReason).toBe('stop');
    expect(reply.toolCalls).toHaveLength(0);
    expect(reply.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(calls[0]?.messages[0]).toEqual({
      role: 'system',
      content: baseConfig.systemPrompt,
    });
    expect(calls[0]?.toolNames).toEqual(['kb_search']);
  });

  it('runs the tool-call loop and stitches tool results back into the conversation', async () => {
    const { provider, calls } = createStubProvider({
      responses: [
        toolCallResponse('call_1', 'kb_search', { query: 'opening hours' }),
        plainTextResponse('We are open 9 to 5.'),
      ],
    });
    const mcp = makeMcp();

    const reply = await runAgent({
      config: baseConfig,
      history: [{ authorType: 'end_user', body: 'when are you open?' }],
      mcp,
      provider,
    });

    expect(reply.body).toBe('We are open 9 to 5.');
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0]?.name).toBe('kb_search');
    expect(reply.toolCalls[0]?.args).toEqual({ query: 'opening hours' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mcp.callTool).toHaveBeenCalledWith('kb_search', { query: 'opening hours' });

    expect(reply.usage.totalTokens).toBe(27);

    const secondCallMessages = calls[1]?.messages ?? [];
    const toolMessage = secondCallMessages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('kb result: hours 9-5');
    expect(toolMessage?.tool_call_id).toBe('call_1');
  });

  it('caps the tool-call loop with tool_iteration_limit', async () => {
    const responses: ProviderResponse[] = Array.from({ length: 3 }, (_, i) =>
      toolCallResponse(`call_${i}`, 'kb_search', { query: `q${i}` }),
    );
    const { provider } = createStubProvider({ responses });

    const reply = await runAgent({
      config: { ...baseConfig, maxToolIterations: 3 },
      history: [{ authorType: 'end_user', body: 'loop forever' }],
      mcp: makeMcp(),
      provider,
    });

    expect(reply.finishReason).toBe('tool_iteration_limit');
    expect(reply.body).toBe('');
    expect(reply.toolCalls).toHaveLength(3);
  });

  it('aborts mid-loop when abortSignal fires', async () => {
    const { provider } = createStubProvider({
      responses: [
        toolCallResponse('call_1', 'kb_search', { query: 'x' }),
        plainTextResponse('Final answer.'),
      ],
    });
    const controller = new AbortController();
    const mcp = makeMcp({
      callTool: vi.fn(() => {
        controller.abort();
        return Promise.resolve({ content: [{ type: 'text' as const, text: 'done' }] });
      }),
    });

    await expect(
      runAgent({
        config: baseConfig,
        history: [{ authorType: 'end_user', body: 'go' }],
        mcp,
        provider,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it('maps history author types to chat roles correctly', async () => {
    const { provider, calls } = createStubProvider({
      responses: [plainTextResponse('ack')],
    });
    const history: ConversationMessage[] = [
      { authorType: 'end_user', body: 'first user msg' },
      { authorType: 'agent', body: 'agent reply' },
      { authorType: 'staff', body: 'staff note' },
      { authorType: 'end_user', body: 'second user msg' },
    ];

    await runAgent({
      config: baseConfig,
      history,
      mcp: makeMcp(),
      provider,
    });

    const sent = calls[0]?.messages ?? [];
    expect(sent[0]?.role).toBe('system');
    expect(sent[1]).toMatchObject({ role: 'user', content: 'first user msg' });
    expect(sent[2]).toMatchObject({ role: 'assistant', content: 'agent reply' });
    expect(sent[3]?.role).toBe('user');
    expect(sent[3]?.name).toBe('staff');
    expect(sent[4]).toMatchObject({ role: 'user', content: 'second user msg' });
  });
});
