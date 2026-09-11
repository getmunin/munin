import { describe, expect, it } from 'vitest';
import { resolveFirstRunView } from './first-run-view';
import type { SetupState } from './use-setup-state';

function setupState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    known: true,
    stage: 'active',
    mcpUrl: null,
    liveChannels: [],
    pendingChannels: [],
    agentConnected: false,
    externalMcpCallCount: 0,
    lastExternalMcpCallAt: null,
    conversationCount: 0,
    topicCount: 0,
    knowledgeDocumentCount: 0,
    reviewQueue: null,
    loading: false,
    isFirstRun: false,
    reload: async () => {},
    ...overrides,
  };
}

describe('resolveFirstRunView', () => {
  it('waits while the setup snapshot is still loading', () => {
    expect(resolveFirstRunView(setupState({ loading: true }))).toBe('loading');
  });

  it('shows first run as soon as setup resolves, without waiting for page content', () => {
    const setup = setupState({ isFirstRun: true, stage: 'listening' });
    expect(resolveFirstRunView(setup, { content: false })).toBe('firstRun');
  });

  it('waits for page content only once first run is ruled out', () => {
    expect(resolveFirstRunView(setupState(), { content: false })).toBe('loading');
    expect(resolveFirstRunView(setupState(), { content: true })).toBe('content');
  });

  it('lets a page narrow first run to its own emptiness rule', () => {
    const setup = setupState({ isFirstRun: true, topicCount: 3 });
    expect(resolveFirstRunView(setup, { firstRun: (s) => s.topicCount === 0 })).toBe('content');
    expect(resolveFirstRunView(setup, { firstRun: () => true })).toBe('firstRun');
  });

  it('waits rather than guessing when the page cannot decide first run yet', () => {
    const setup = setupState({ isFirstRun: true });
    expect(resolveFirstRunView(setup, { firstRun: () => null })).toBe('loading');
  });

  it('never consults the page rules for a workspace past first run', () => {
    const setup = setupState({ isFirstRun: false });
    expect(resolveFirstRunView(setup, { firstRun: () => null })).toBe('content');
  });
});
