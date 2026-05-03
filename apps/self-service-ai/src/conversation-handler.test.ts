import { describe, expect, it, vi } from 'vitest';
import { createConversationHandler, type OpenedMcp } from './conversation-handler.js';
import type { SidecarConfig } from './config.js';
import type { ConversationDetail, MuninRestClient } from './munin-rest.js';
import type { McpToolResult, Provider, ProviderResponse } from '@getmunin/agent-runtime';

const baseConfig: SidecarConfig = {
  muninBaseUrl: 'http://munin',
  muninAdminApiKey: 'mn_admin_test',
  providerBaseUrl: 'http://provider',
  providerApiKey: 'sk-test',
  model: 'test-model',
  systemPrompt: 'sys',
  debounceMs: 0,
  maxToolIterations: 4,
};

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
      openMcp: () => Promise.resolve(buildMcp()),
      logger: silentLogger,
      scheduler: noDelayScheduler,
    });
    handler.handle({ conversationId: 'conv_1', authorType: 'end_user' });
    await handler.flush();
    expect(postSpy).not.toHaveBeenCalled();
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
});
