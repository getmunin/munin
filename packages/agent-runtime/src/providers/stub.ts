import type { ChatMessage, Provider, ProviderResponse } from '../types.js';

export interface StubScript {
  responses: ProviderResponse[];
}

export interface StubProviderHandle {
  provider: Provider;
  /** Captured calls in order. */
  calls: Array<{ messages: ChatMessage[]; toolNames: string[] }>;
}

export function createStubProvider(script: StubScript): StubProviderHandle {
  const queue = [...script.responses];
  const calls: StubProviderHandle['calls'] = [];

  const provider: Provider = ({ messages, tools, abortSignal }) => {
    if (abortSignal?.aborted) {
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }
    calls.push({
      messages: messages.map((m) => ({ ...m })),
      toolNames: tools.map((t) => t.function.name),
    });
    const next = queue.shift();
    if (!next) {
      return Promise.reject(new Error('stub provider exhausted: no scripted responses left'));
    }
    return Promise.resolve(next);
  };

  return { provider, calls };
}
