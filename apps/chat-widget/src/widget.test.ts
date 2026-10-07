import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WidgetConfig } from './config.ts';

const h = vi.hoisted(() => {
  const listeners: { state?: (s: string) => void } = {};
  return {
    listeners,
    identify: vi.fn(() => Promise.resolve({ endUserId: 'eu_1', contactId: 'ctc_1' })),
    backfillSince: vi.fn(
      (): Promise<{
        messages: unknown[];
        hasMore: boolean;
        cursor?: string | null;
        conversation: {
          id: string;
          subject: string | null;
          status: string;
          handedOver: boolean;
          assigneeName: string | null;
          agentName: string | null;
          contactEmail: string | null;
        } | null;
      }> => Promise.resolve({ messages: [], hasMore: false, conversation: null }),
    ),
    listConversations: vi.fn(() => Promise.resolve([])),
    setVoiceCallWho: vi.fn(),
    startConversation: vi.fn(() => Promise.resolve({ conversationId: 'conv_new' })),
    voiceStart: vi.fn(
      (): Promise<{ available: false; reason: string } | { available: true; descriptor: unknown }> =>
        Promise.resolve({ available: true, descriptor: { vendor: 'vapi' } }),
    ),
    createVoiceSession: vi.fn(() => ({
      start: vi.fn(() => Promise.resolve()),
      end: vi.fn(() => Promise.resolve()),
      setMuted: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    })),
    setVoiceState: vi.fn(),
    setView: vi.fn(),
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
    startConversation: h.startConversation,
    voiceAvailable: vi.fn(),
    voiceStart: h.voiceStart,
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
  mount: () => {
    let open = false;
    const stateful: Record<string, () => unknown> = {
      open: () => {
        open = true;
      },
      close: () => {
        open = false;
      },
      isOpen: () => open,
      setVoiceCallWho: h.setVoiceCallWho,
      setVoiceState: h.setVoiceState,
      setView: h.setView,
    };
    return new Proxy(stateful, {
      get: (target, prop) => (typeof prop === 'string' && prop in target ? target[prop] : vi.fn()),
    });
  },
}));

vi.mock('@getmunin/widget-voice', () => ({
  createVoiceSession: h.createVoiceSession,
}));

const { start } = await import('./widget.ts');

const documentClickListeners: EventListenerOrEventListenerObject[] = [];
const addDocumentListener = document.addEventListener.bind(document);
document.addEventListener = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) => {
  if (!listener) return;
  if (type === 'click') documentClickListeners.push(listener);
  addDocumentListener(type, listener, options);
};

afterEach(() => {
  for (const listener of documentClickListeners.splice(0)) {
    document.removeEventListener('click', listener);
  }
});

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
  fonts: 'inherit',
  corners: 'square',
  colorScheme: 'auto',
  showHistory: true,
  nudge: null,
  nudgeDelayMs: 8000,
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
    expect(h.identify).toHaveBeenCalledWith('user_42', HASH, undefined);

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

interface MnWidgetApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  identify: (externalId: string, userHash: string, options?: { email?: string }) => Promise<void>;
  call: () => Promise<{ started: boolean; reason?: string }>;
  endCall: () => Promise<void>;
  ready: boolean;
}

interface WindowWithMnWidget {
  mn?: { widget?: MnWidgetApi };
}

function getMnWidget(): MnWidgetApi {
  const widget = (window as Window & WindowWithMnWidget).mn?.widget;
  if (!widget) throw new Error('window.mn.widget not installed');
  return widget;
}

describe('window.mn.widget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.state = undefined;
    document.body.innerHTML = '';
    delete (window as Window & WindowWithMnWidget).mn;
  });

  it('exposes open/close/toggle/isOpen bound to the mounted panel', () => {
    start({ ...baseConfig });
    const widget = getMnWidget();

    expect(widget.isOpen()).toBe(false);
    widget.open();
    expect(widget.isOpen()).toBe(true);
    widget.close();
    expect(widget.isOpen()).toBe(false);
  });

  it('toggle() flips between open and closed', () => {
    start({ ...baseConfig });
    const widget = getMnWidget();

    widget.toggle();
    expect(widget.isOpen()).toBe(true);
    widget.toggle();
    expect(widget.isOpen()).toBe(false);
  });

  it('identifies through the namespace, never the shared root', async () => {
    start({ ...baseConfig });
    await getMnWidget().identify('user_42', HASH);

    await vi.waitFor(() => expect(h.identify).toHaveBeenCalledWith('user_42', HASH, undefined));
    expect((window as Window & { mn?: { identify?: unknown } }).mn?.identify).toBeUndefined();
  });

  it('passes a signed email given to identify', async () => {
    start({ ...baseConfig });
    await getMnWidget().identify('user_42', HASH, { email: 'ola@example.test' });

    await vi.waitFor(() =>
      expect(h.identify).toHaveBeenCalledWith('user_42', HASH, 'ola@example.test'),
    );
  });

  it('announces readiness so a caller can gate on the namespace existing', () => {
    const listener = vi.fn();
    document.addEventListener('munin:widget-ready', listener, { once: true });
    start({ ...baseConfig });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getMnWidget().ready).toBe(true);
  });
});

describe('window.mn.widget collisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.state = undefined;
    document.body.innerHTML = '';
    delete (window as Window & WindowWithMnWidget).mn;
  });

  it('leaves the global bound to the first embed and warns on the second', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    start({ ...baseConfig });
    const first = getMnWidget();
    first.open();

    start({ ...baseConfig, channelId: 'cch_other' });

    expect(getMnWidget()).toBe(first);
    expect(getMnWidget().isOpen()).toBe(true);
    expect(warn.mock.calls.flat().join(' ')).toContain('already installed');
    warn.mockRestore();
  });
});

describe('voice call name', () => {
  const envelope = {
    id: 'conv_1',
    subject: null,
    status: 'open',
    handedOver: false,
    assigneeName: null,
    agentName: null,
    contactEmail: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.state = undefined;
    document.body.innerHTML = '';
    delete (window as Window & WindowWithMnWidget).mn;
  });

  it('uses the org assistant name from the conversation envelope', async () => {
    h.backfillSince.mockResolvedValueOnce({
      messages: [],
      hasMore: false,
      conversation: { ...envelope, agentName: 'Thea' },
    });
    start({ ...baseConfig });
    h.listeners.state!('connected');

    await vi.waitFor(() => expect(h.setVoiceCallWho).toHaveBeenCalled());
    expect(h.setVoiceCallWho).toHaveBeenCalledWith('Thea');
  });

  it('falls back to the generic author name when no assistant name is set', async () => {
    h.backfillSince.mockResolvedValueOnce({
      messages: [],
      hasMore: false,
      conversation: { ...envelope, agentName: null },
    });
    start({ ...baseConfig });
    h.listeners.state!('connected');

    await vi.waitFor(() => expect(h.setVoiceCallWho).toHaveBeenCalled());
    expect(h.setVoiceCallWho).toHaveBeenCalledWith('Agent');
  });

  it('prefers the human assignee over the assistant name once handed over', async () => {
    h.backfillSince.mockResolvedValueOnce({
      messages: [],
      hasMore: false,
      conversation: { ...envelope, handedOver: true, assigneeName: 'Maja', agentName: 'Thea' },
    });
    start({ ...baseConfig });
    h.listeners.state!('connected');

    await vi.waitFor(() => expect(h.setVoiceCallWho).toHaveBeenCalled());
    expect(h.setVoiceCallWho).toHaveBeenCalledWith('Maja');
  });
});

describe('calling from the host page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.state = undefined;
    document.body.innerHTML = '';
    delete (window as Window & WindowWithMnWidget).mn;
  });

  it('opens the panel, starts a conversation and connects the call', async () => {
    start({ ...baseConfig });
    const widget = getMnWidget();

    const result = await widget.call();

    expect(result).toEqual({ started: true });
    expect(widget.isOpen()).toBe(true);
    expect(h.setView).toHaveBeenCalledWith('chat');
    expect(h.startConversation).toHaveBeenCalledTimes(1);
    expect(h.voiceStart).toHaveBeenCalledWith('conv_new');
    expect(h.createVoiceSession).toHaveBeenCalledTimes(1);
  });

  it('reuses the conversation already on screen instead of starting another', async () => {
    h.backfillSince.mockResolvedValueOnce({
      messages: [],
      hasMore: false,
      conversation: {
        id: 'conv_existing',
        subject: null,
        status: 'open',
        handedOver: false,
        assigneeName: null,
        agentName: null,
        contactEmail: null,
      },
    });
    start({ ...baseConfig });
    h.listeners.state!('connected');
    await vi.waitFor(() => expect(h.setVoiceCallWho).toHaveBeenCalled());

    await getMnWidget().call();

    expect(h.startConversation).not.toHaveBeenCalled();
    expect(h.voiceStart).toHaveBeenCalledWith('conv_existing');
  });

  it('reports why when the channel has no voice configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.voiceStart.mockResolvedValueOnce({ available: false, reason: 'voice_not_configured' });
    start({ ...baseConfig });

    const result = await getMnWidget().call();

    expect(result).toEqual({ started: false, reason: 'voice_not_configured' });
    expect(h.createVoiceSession).not.toHaveBeenCalled();
    expect(getMnWidget().isOpen()).toBe(true);
    warn.mockRestore();
  });

  it('places one call when triggered twice in quick succession', async () => {
    start({ ...baseConfig });
    const widget = getMnWidget();

    const [first, second] = await Promise.all([widget.call(), widget.call()]);

    expect([first, second]).toContainEqual({ started: true });
    expect([first, second]).toContainEqual({ started: false, reason: 'already_in_call' });
    expect(h.createVoiceSession).toHaveBeenCalledTimes(1);
  });

  it('ends an active call through endCall()', async () => {
    start({ ...baseConfig });
    const widget = getMnWidget();
    await widget.call();
    const session = h.createVoiceSession.mock.results[0]!.value as { end: () => Promise<void> };

    await widget.endCall();

    expect(session.end).toHaveBeenCalledTimes(1);
    expect(h.setVoiceState).toHaveBeenLastCalledWith('ended');
  });

  it('starts a call from any element carrying data-munin-call', async () => {
    start({ ...baseConfig });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<a href="#call" data-munin-call><span id="inner">Call us</span></a>',
    );
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    document.getElementById('inner')!.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(h.createVoiceSession).toHaveBeenCalledTimes(1));
    expect(getMnWidget().isOpen()).toBe(true);
  });

  it('ignores clicks outside data-munin-call elements', async () => {
    start({ ...baseConfig });
    document.body.insertAdjacentHTML('beforeend', '<button id="other">Other</button>');

    document.getElementById('other')!.click();
    await Promise.resolve();

    expect(h.startConversation).not.toHaveBeenCalled();
    expect(h.voiceStart).not.toHaveBeenCalled();
  });
});
