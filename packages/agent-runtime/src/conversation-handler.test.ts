import { describe, expect, it, vi } from 'vitest';
import {
  createConversationHandler,
  type HandlerConfig,
  type OpenedMcp,
} from './conversation-handler.js';
import type { ConversationDetail, MuninRestClient } from './munin-rest.js';
import type { PromptResolver } from './prompt-resolver.js';
import type { McpToolResult, Provider, ProviderResponse } from './types.js';

const baseConfig: HandlerConfig = {
  providerBaseUrl: 'http://provider',
  providerApiKey: 'sk-test',
  model: 'test-model',
  debounceMs: 0,
  maxToolIterations: 4,
  maxHistoryChars: 32_000,
};

function buildPrompts(overrides: Partial<{ system: string; channels: Record<string, string> }> = {}): PromptResolver {
  const channels = overrides.channels ?? {};
  return {
    system: () => overrides.system ?? 'sys',
    channel: (kind: string) => channels[kind] ?? channels['default'] ?? '',
    isPromptDocument: () => false,
    refresh: () => Promise.resolve(),
    refreshAll: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const noDelayScheduler = {
  delay: (_ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      queueMicrotask(() => {
        if (signal.aborted) reject(new DOMException('aborted', 'AbortError'));
        else resolve();
      });
    }),
};

function buildConversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: 'conv_1',
    status: 'open',
    endUserId: 'eu_1',
    assigneeUserId: null,
    messages: [
      {
        id: 'msg_1',
        authorType: 'end_user',
        body: 'when do you open?',
        createdAt: new Date().toISOString(),
        internal: false,
      },
    ],
    ...overrides,
  };
}

function buildRest(overrides: Partial<MuninRestClient> = {}): MuninRestClient {
  return {
    getConversation: vi.fn(() => Promise.resolve(buildConversation())),
    postAgentMessage: vi.fn(() => Promise.resolve()),
    postInternalNote: vi.fn(() => Promise.resolve()),
    mintDelegatedToken: vi.fn(() =>
      Promise.resolve({
        accessToken: 'mn_eu_test',
        endUserId: 'eu_1',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    ),
    toRuntimeHistory: (detail) =>
      detail.messages
        .filter((m) => !m.internal)
        .map((m) => ({ authorType: m.authorType, body: m.body, createdAt: m.createdAt })),
    changeStatus: vi.fn(() => Promise.resolve()),
    setTopic: vi.fn(() => Promise.resolve()),
    listTopics: vi.fn(() => Promise.resolve([])),
    enqueueCuratorJob: vi.fn(() =>
      Promise.reject(new Error('enqueueCuratorJob not stubbed for this test')),
    ),
    claimCuratorJobs: vi.fn(() => Promise.resolve([])),
    ackCuratorJob: vi.fn(() =>
      Promise.reject(new Error('ackCuratorJob not stubbed for this test')),
    ),
    failCuratorJob: vi.fn(() =>
      Promise.reject(new Error('failCuratorJob not stubbed for this test')),
    ),
    tryAcquireConversation: vi.fn(() =>
      Promise.resolve({ acquired: true, leaseExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    ),
    releaseConversationClaim: vi.fn(() => Promise.resolve({ released: true })),
    ...overrides,
  };
}

function buildMcp(opts: {
  reply?: string;
  callToolError?: Error;
} = {}): OpenedMcp {
  return {
    listTools: vi.fn(() => Promise.resolve([])),
    callTool: vi.fn((): Promise<McpToolResult> =>
      opts.callToolError
        ? Promise.reject(opts.callToolError)
        : Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }),
    ),
    close: vi.fn(() => Promise.resolve()),
  };
}

describe('createConversationHandler', () => {
  it('skips when authorType is agent (no self-replies)', async () => {
    const rest = buildRest();
    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
    });
    handler.handle({ conversationId: 'conv_1', authorType: 'agent' });
    await handler.flush();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(rest.getConversation).not.toHaveBeenCalled();
  });

  it('skips when conversation is closed', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() => Promise.resolve(buildConversation({ status: 'closed' }))),
    });
    const postSpy = vi.fn(() => Promise.resolve());
    rest.postAgentMessage = postSpy;
    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
    });
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('skips when conversation has been claimed by staff', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() => Promise.resolve(buildConversation({ assigneeUserId: 'user_42' }))),
    });
    const postSpy = vi.fn(() => Promise.resolve());
    rest.postAgentMessage = postSpy;
    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
    });
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('skips when another runner already owns the conversation', async () => {
    const rest = buildRest();
    const postSpy = vi.fn(() => Promise.resolve());
    rest.postAgentMessage = postSpy;
    const acquireSpy = vi.fn(() =>
      Promise.resolve({ acquired: false, heldBy: 'runner-other' }),
    );
    rest.tryAcquireConversation = acquireSpy;
    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
    });
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('passes sinceMessageId on postAgentMessage so the backend can dedup', async () => {
    const conversation = buildConversation();
    const lastMessageId = conversation.messages[conversation.messages.length - 1]!.id;
    const rest = buildRest({
      getConversation: vi.fn(() => Promise.resolve(conversation)),
    });
    const postSpy = vi.fn(() => Promise.resolve());
    rest.postAgentMessage = postSpy;
    const stubProvider: Provider = () =>
      Promise.resolve({
        message: { role: 'assistant', content: 'sure thing' },
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        finishReason: 'stop',
      });
    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
      provider: stubProvider,
    });
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    expect(postSpy).toHaveBeenCalledTimes(1);
    const call = postSpy.mock.calls[0] as unknown as [string, string, { sinceMessageId?: string }];
    expect(call[2]?.sinceMessageId).toBe(lastMessageId);
  });

  it('calls handover tool after MAX_RETRIES provider failures', async () => {
    const handoverCalls: string[] = [];
    const buildFailingMcp = (): OpenedMcp => ({
      listTools: vi.fn(() =>
        Promise.resolve([
          {
            name: 'kb_search',
            description: 'kb',
            inputSchema: { type: 'object', properties: {} },
          },
        ]),
      ),
      callTool: vi.fn((name: string) => {
        handoverCalls.push(name);
        return Promise.resolve<McpToolResult>({ content: [] });
      }),
      close: vi.fn(() => Promise.resolve()),
    });
    const rest = buildRest();
    const postSpy = vi.fn(() => Promise.resolve());
    rest.postAgentMessage = postSpy;

    // Provider always errors → runAgent rethrows from listTools→provider call.
    // We simulate this by making the first call to listTools succeed but the
    // openai provider call fail. Easiest: make openMcp return a handle whose
    // listTools throws on the first three runs, then succeeds for handover.
    let runCount = 0;
    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => {
        runCount += 1;
        if (runCount <= 3) {
          return Promise.resolve({
            listTools: vi.fn(() => Promise.reject(new Error('provider boom'))),
            callTool: vi.fn(() => Promise.resolve<McpToolResult>({ content: [] })),
            close: vi.fn(() => Promise.resolve()),
          });
        }
        return Promise.resolve(buildFailingMcp());
      },
      logger: silentLogger,
      scheduler: noDelayScheduler,
    });

    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();

    expect(postSpy).not.toHaveBeenCalled();
    expect(handoverCalls).toEqual(['conv_request_handover_in_my_conversation']);
  });

  it('caches the delegated token per end-user across triggering events', async () => {
    const rest = buildRest();
    const mintSpy = vi.fn(() =>
      Promise.resolve({
        accessToken: 'mn_eu_cached',
        endUserId: 'eu_1',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    rest.mintDelegatedToken = mintSpy;

    const happyResponse: ProviderResponse = {
      message: { role: 'assistant', content: 'hi' },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      finishReason: 'stop',
    };
    const stubProvider: Provider = () => Promise.resolve(happyResponse);

    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
      provider: stubProvider,
    });

    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();

    expect(mintSpy).toHaveBeenCalledTimes(1);
  });

  it('re-mints when the cached token is within the refresh margin', async () => {
    const rest = buildRest();
    let call = 0;
    const mintSpy = vi.fn(() => {
      call += 1;
      // First mint returns a token expiring in 30s (inside the 60s margin).
      // Second mint returns a fresh long-lived token.
      const ttlMs = call === 1 ? 30_000 : 600_000;
      return Promise.resolve({
        accessToken: `mn_eu_${call}`,
        endUserId: 'eu_1',
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      });
    });
    rest.mintDelegatedToken = mintSpy;

    const happyResponse: ProviderResponse = {
      message: { role: 'assistant', content: 'hi' },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      finishReason: 'stop',
    };
    const stubProvider: Provider = () => Promise.resolve(happyResponse);

    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
      provider: stubProvider,
    });

    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();

    expect(mintSpy).toHaveBeenCalledTimes(2);
  });

  it('aborts the in-flight debounce when a new triggering event arrives for the same conversation', async () => {
    const pending: Array<{ resolve: () => void; reject: (e: unknown) => void; signal: AbortSignal }> = [];
    const collectingScheduler = {
      delay: (_ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          const entry = { resolve, reject, signal };
          pending.push(entry);
          signal.addEventListener('abort', () => {
            entry.reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    };

    const getConvMock = vi.fn(() => Promise.resolve(buildConversation()));
    const rest = buildRest();
    rest.getConversation = getConvMock;

    const happyResponse: ProviderResponse = {
      message: { role: 'assistant', content: 'hi' },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      finishReason: 'stop',
    };
    const stubProvider: Provider = () => Promise.resolve(happyResponse);

    const handlerWithProvider = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: collectingScheduler,
      provider: stubProvider,
    });

    handlerWithProvider.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    handlerWithProvider.handle({ conversationId: 'conv_1', authorType: 'end_user' });

    await new Promise((r) => setTimeout(r, 0));
    const live = pending.find((p) => !p.signal.aborted);
    live?.resolve();
    await handlerWithProvider.flush();

    expect(getConvMock).toHaveBeenCalledTimes(1);
  });

  it('appends the resolver-provided channel descriptor to the system prompt', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() =>
        Promise.resolve(buildConversation({ channelType: 'email' })),
      ),
    });
    const captured: string[] = [];
    const stubProvider: Provider = ({ messages }) => {
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content ?? '');
      captured.push(...sys);
      return Promise.resolve({
        message: { role: 'assistant', content: 'ok' },
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        finishReason: 'stop',
      });
    };

    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts({
        system: 'BASE_SYSTEM',
        channels: { email: 'EMAIL_DESCRIPTOR' },
      }),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
      provider: stubProvider,
    });

    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();

    const composed = captured[0] ?? '';
    expect(composed).toContain('BASE_SYSTEM');
    expect(composed).toContain('EMAIL_DESCRIPTOR');
  });

  it('uses just the system prompt when the channel resolver returns empty', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() =>
        Promise.resolve(buildConversation({ channelType: 'unknown-kind' })),
      ),
    });
    const captured: string[] = [];
    const stubProvider: Provider = ({ messages }) => {
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content ?? '');
      captured.push(...sys);
      return Promise.resolve({
        message: { role: 'assistant', content: 'ok' },
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        finishReason: 'stop',
      });
    };

    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts({ system: 'JUST_BASE' }),
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
      provider: stubProvider,
    });

    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();

    expect(captured[0]).toMatch(/^JUST_BASE\n\n\[Conversation context\]/);
  });
});
