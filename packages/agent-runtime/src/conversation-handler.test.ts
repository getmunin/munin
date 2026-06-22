import { describe, expect, it, vi } from 'vitest';
import {
  createConversationHandler,
  type HandlerConfig,
  type OpenedMcp,
} from './conversation-handler.ts';
import type { ConversationDetail, MuninRestClient } from './munin-rest.ts';
import type { PromptResolver } from './prompt-resolver.ts';
import type { McpToolResult, Provider, ProviderResponse } from './types.ts';

const baseConfig: HandlerConfig = {
  providerBaseUrl: 'http://provider',
  providerApiKey: 'sk-test',
  model: 'test-model',
  debounceMs: 0,
  maxToolIterations: 4,
  maxHistoryChars: 32_000,
};

function buildPrompts(
  overrides: Partial<{
    system: string;
    channels: Record<string, string>;
    companyContext: string;
    voiceSystem: string;
    voiceOpenerCold: string;
    voiceOpenerContinuation: string;
  }> = {},
): PromptResolver {
  const channels = overrides.channels ?? {};
  return {
    system: () => overrides.system ?? 'sys',
    channel: (kind: string) => channels[kind] ?? channels['default'] ?? '',
    companyContext: () => overrides.companyContext ?? '',
    voiceSystem: () => overrides.voiceSystem ?? '',
    voiceOpener: (hasPriorAgentTurn: boolean) =>
      hasPriorAgentTurn
        ? overrides.voiceOpenerContinuation ?? ''
        : overrides.voiceOpenerCold ?? '',
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
    claim: null,
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
    listConversationsAwaitingReply: vi.fn(() => Promise.resolve([])),
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
    updateCuratorJobProgress: vi.fn(() => Promise.resolve()),
    tryAcquireConversation: vi.fn(() =>
      Promise.resolve({ acquired: true, leaseExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    ),
    releaseConversationClaim: vi.fn(() => Promise.resolve({ released: true })),
    requestHandover: vi.fn(() => Promise.resolve()),
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

  it('skips when agentMode is draft_only (an outreach-originated conv)', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() =>
        Promise.resolve(buildConversation({ agentMode: 'draft_only' })),
      ),
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

  it('skips when agentMode is off', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() =>
        Promise.resolve(buildConversation({ agentMode: 'off' })),
      ),
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

  it('skips when a staff member holds an active claim', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() =>
        Promise.resolve(
          buildConversation({
            claim: {
              holderType: 'user',
              holderId: 'user_42',
              expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            },
          }),
        ),
      ),
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

  it('does respond when a prior human reply has been released (no active claim)', async () => {
    const rest = buildRest({
      getConversation: vi.fn(() =>
        Promise.resolve(
          buildConversation({
            claim: null,
            messages: [
              {
                id: 'msg_1',
                authorType: 'end_user',
                body: 'when do you open?',
                createdAt: new Date(Date.now() - 60_000).toISOString(),
                internal: false,
              },
              {
                id: 'msg_2',
                authorType: 'user',
                body: 'we open at 10',
                createdAt: new Date(Date.now() - 30_000).toISOString(),
                internal: false,
              },
              {
                id: 'msg_3',
                authorType: 'end_user',
                body: 'thanks! do you have parking?',
                createdAt: new Date().toISOString(),
                internal: false,
              },
            ],
          }),
        ),
      ),
    });
    const postSpy = vi.fn(() => Promise.resolve());
    rest.postAgentMessage = postSpy;
    const stubProvider: Provider = () =>
      Promise.resolve({
        message: { role: 'assistant', content: 'yes, free parking out front' },
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

  it('calls rest.requestHandover with a public fallback message after MAX_RETRIES provider failures', async () => {
    const rest = buildRest();
    const postSpy = vi.fn(() => Promise.resolve());
    rest.postAgentMessage = postSpy;
    const handoverSpy = vi.fn(() => Promise.resolve());
    rest.requestHandover = handoverSpy;

    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: () =>
        Promise.resolve({
          listTools: vi.fn(() => Promise.reject(new Error('provider boom'))),
          callTool: vi.fn(() => Promise.resolve<McpToolResult>({ content: [] })),
          close: vi.fn(() => Promise.resolve()),
        }),
      logger: silentLogger,
      scheduler: noDelayScheduler,
    });

    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();

    expect(postSpy).not.toHaveBeenCalled();
    expect(handoverSpy).toHaveBeenCalledTimes(1);
    const [conversationId, args] = handoverSpy.mock.calls[0] as unknown as [
      string,
      { reason?: string; publicFallbackMessage?: string },
    ];
    expect(conversationId).toBe('conv_1');
    expect(args.reason).toMatch(/retries exhausted/);
    expect(args.publicFallbackMessage).toMatch(/teammate will follow up/);
  });

  it('passes endUserId to openMcp once per attempt and never calls rest.mintDelegatedToken', async () => {
    const rest = buildRest();
    const mintSpy = vi.fn(() =>
      Promise.resolve({
        accessToken: 'unused',
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

    const openMcpSpy = vi.fn((_opts: { endUserId: string }) => Promise.resolve(buildMcp()));
    const handler = createConversationHandler({
      config: baseConfig,
      rest,
      prompts: buildPrompts(),
      openMcp: openMcpSpy,
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

    expect(mintSpy).not.toHaveBeenCalled();
    expect(openMcpSpy).toHaveBeenCalledTimes(3);
    expect(openMcpSpy.mock.calls[0]?.[0]).toEqual({ endUserId: 'eu_1' });
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
