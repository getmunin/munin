import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WidgetConfig } from './config.ts';

const h = vi.hoisted(() => {
  const listeners: { state?: (s: string) => void } = {};
  return {
    listeners,
    identify: vi.fn(() => Promise.resolve({ endUserId: 'eu_1', contactId: 'ctc_1' })),
    backfillSince: vi.fn(() =>
      Promise.resolve({ messages: [], hasMore: false, conversation: null }),
    ),
    listConversations: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('./session.ts', () => ({
  getSessionId: () => 'sess_1',
  getVisitorId: () => 'vis_1',
  getRecentSessionIds: () => ['sess_1'],
  mintNewSession: () => 'sess_2',
  setCurrentSession: () => {},
}));

vi.mock('./api.ts', () => ({
  WidgetApiError: class extends Error {
    constructor(public status: number) {
      super(`status ${status}`);
    }
  },
  createApiClient: () => ({
    postMessage: vi.fn(),
    backfillSince: h.backfillSince,
    listConversations: h.listConversations,
    setVisitorEmail: vi.fn(),
    startConversation: vi.fn(),
    voiceAvailable: vi.fn(),
    voiceStart: vi.fn(),
    voiceEvent: vi.fn(),
    identify: h.identify,
    setSessionId: vi.fn(),
  }),
}));

vi.mock('./realtime.ts', () => ({
  createRealtimeClient: () => ({
    connect: vi.fn(),
    close: vi.fn(),
    reconnect: vi.fn(),
    state: () => 'connected',
    sendTyping: vi.fn(),
    sendRead: vi.fn(),
    setSessionId: vi.fn(),
    onEvent: () => () => {},
    onTyping: () => () => {},
    onState: (l: (s: string) => void) => {
      h.listeners.state = l;
      return () => {};
    },
  }),
}));

vi.mock('./ui.ts', () => ({
  mount: () => new Proxy({}, { get: () => vi.fn() }),
}));

vi.mock('@getmunin/widget-voice', () => ({
  createVoiceSession: vi.fn(),
}));

const { start } = await import('./widget.ts');

const baseConfig: WidgetConfig = {
  host: 'https://munin.example',
  widgetKey: 'mn_widget_abc',
  channelId: 'cch_chan',
  themeColor: '#10b981',
  position: 'bottom-right',
  greeting: null,
  title: null,
  eyebrow: null,
  locale: null,
  size: 'standard',
  fonts: 'system',
  showHistory: true,
};

const HASH = 'a'.repeat(64);

describe('widget identity carry-over', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.state = undefined;
    document.body.innerHTML = '';
  });

  it('claims the configured identity on connect, before loading history', async () => {
    start({ ...baseConfig, externalId: 'user_42', userHash: HASH });
    expect(h.listeners.state).toBeTypeOf('function');

    h.listeners.state!('connected');

    await vi.waitFor(() => expect(h.identify).toHaveBeenCalledTimes(1));
    expect(h.identify).toHaveBeenCalledWith('user_42', HASH);

    await vi.waitFor(() => expect(h.listConversations).toHaveBeenCalled());
    expect(h.identify.mock.invocationCallOrder[0]!).toBeLessThan(
      h.listConversations.mock.invocationCallOrder[0]!,
    );
  });

  it('does not call identify for an anonymous visitor', async () => {
    start({ ...baseConfig });

    h.listeners.state!('connected');
    await vi.waitFor(() => expect(h.listConversations).toHaveBeenCalled());

    expect(h.identify).not.toHaveBeenCalled();
  });

  it('claims only once across reconnects', async () => {
    start({ ...baseConfig, externalId: 'user_42', userHash: HASH });

    h.listeners.state!('connected');
    await vi.waitFor(() => expect(h.identify).toHaveBeenCalledTimes(1));

    h.listeners.state!('connected');
    await vi.waitFor(() => expect(h.listConversations).toHaveBeenCalledTimes(2));

    expect(h.identify).toHaveBeenCalledTimes(1);
  });
});
