import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, type UiController } from './ui.ts';
import type { ListedMessage, ConversationSummary } from './api.ts';
import type { WidgetConfig } from './config.ts';
import strings from './strings/en.ts';

const baseConfig: WidgetConfig = {
  host: 'https://munin.example',
  widgetKey: 'mn_widget_abc',
  channelId: 'cnv_chan',
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

let controller: UiController | null = null;

afterEach(() => {
  controller?.destroy();
  controller = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function shadowRoot(): ShadowRoot {
  const host = document.querySelector('[data-munin-widget]');
  if (!host) throw new Error('widget host not mounted');
  const sr = (host as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
  if (!sr) throw new Error('expected open shadowRoot');
  return sr;
}

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = shadowRoot().querySelector(selector);
  if (!el) throw new Error(`no element matched ${selector}`);
  return el as T;
}

function $$(selector: string): Element[] {
  return Array.from(shadowRoot().querySelectorAll(selector));
}

function msg(partial: Partial<ListedMessage> & { id: string; role: ListedMessage['role']; body: string }): ListedMessage {
  return {
    authorKind: partial.role === 'agent' ? 'ai' : null,
    authorName: partial.role === 'agent' ? 'Munin' : null,
    bodyHtml: null,
    at: '2026-01-01T00:00:00Z',
    readAt: null,
    ...partial,
  };
}

describe('ui: mount + lifecycle', () => {
  it('attaches an open Shadow DOM host and renders the launcher visible, panel hidden', () => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    const host = document.querySelector('[data-munin-widget]');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
    expect(($('.launcher')).hidden).toBe(false);
    expect(($('.panel')).hidden).toBe(true);
  });

  it('opens the panel on launcher click, lands on the welcome screen', () => {
    const onOpen = vi.fn();
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {}, onOpen });
    ($('.launcher')).click();
    expect(($('.panel')).hidden).toBe(false);
    expect(($('.launcher')).hidden).toBe(true);
    expect(($('.welcome')).hidden).toBe(false);
    expect(($('.chat')).hidden).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders the configured greeting and eyebrow on the welcome screen', () => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    expect($('.welcome-eyebrow').textContent).toBe('Powered by Munin');
    // First sentence renders plain, second renders italic <em>.
    const h1 = $('.welcome-h1');
    expect(h1.textContent).toMatch(/Hi there\.\s*How can we help\?/);
    expect(h1.querySelector('em')?.textContent).toBe('How can we help?');
  });

  it('destroy() removes the host element', () => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    expect(document.querySelector('[data-munin-widget]')).not.toBeNull();
    controller.destroy();
    controller = null;
    expect(document.querySelector('[data-munin-widget]')).toBeNull();
  });
});

describe('ui: mobile full-screen body scroll lock', () => {
  const origMatchMedia = window.matchMedia;
  const origScrollTo = window.scrollTo;

  function setViewport(matches: boolean): void {
    window.matchMedia = vi.fn().mockReturnValue({ matches });
  }

  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    window.matchMedia = origMatchMedia;
    window.scrollTo = origScrollTo;
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  it('locks body scroll on open and restores it on close when the viewport is phone-sized', () => {
    setViewport(true);
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
    ($('[data-act="close"]')).click();
    expect(document.body.getAttribute('style')).toBeNull();
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('does not touch body scroll on larger viewports', () => {
    setViewport(false);
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    expect(document.body.getAttribute('style')).toBeNull();
  });

  it('restores body scroll when destroyed while open', () => {
    setViewport(true);
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    expect(document.body.style.position).toBe('fixed');
    controller.destroy();
    controller = null;
    expect(document.body.getAttribute('style')).toBeNull();
  });
});

describe('ui: launcher unread badge', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
  });

  it('hides the badge by default', () => {
    expect($('.launcher-badge').hidden).toBe(true);
  });

  it('shows the count when setLauncherUnread is called with a positive number', () => {
    controller!.setLauncherUnread(3);
    const badge = $('.launcher-badge');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('3');
  });

  it('caps the displayed count at 9+', () => {
    controller!.setLauncherUnread(42);
    expect($('.launcher-badge').textContent).toBe('9+');
  });

  it('hides the badge again when count drops to 0', () => {
    controller!.setLauncherUnread(2);
    controller!.setLauncherUnread(0);
    expect($('.launcher-badge').hidden).toBe(true);
  });
});

describe('ui: welcome → chat transitions', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
  });

  it('fires onStartConversation when the CTA is clicked', () => {
    const onStart = vi.fn();
    controller!.destroy();
    controller = mount(baseConfig, strings, {
      onSend: () => {},
      onTypingIntent: () => {},
      onStartConversation: onStart,
    });
    ($('.launcher')).click();
    ($('.cta')).click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('setView swaps the visible screen', () => {
    expect(($('.welcome')).hidden).toBe(false);
    expect(($('.chat')).hidden).toBe(true);
    controller!.setView('chat');
    expect(($('.welcome')).hidden).toBe(true);
    expect(($('.chat')).hidden).toBe(false);
  });

  it('back button on the chat fires onBackToWelcome and returns to welcome', () => {
    const onBack = vi.fn();
    controller!.destroy();
    controller = mount(baseConfig, strings, {
      onSend: () => {},
      onTypingIntent: () => {},
      onBackToWelcome: onBack,
    });
    ($('.launcher')).click();
    controller.setView('chat');
    ($('.back-btn')).click();
    expect(onBack).toHaveBeenCalled();
    expect(($('.welcome')).hidden).toBe(false);
  });
});

describe('ui: past conversations', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
  });

  it('renders an empty state when no past conversations are set', () => {
    controller!.setPastConversations([]);
    expect(($('.empty')).hidden).toBe(false);
    expect(($('.past')).hidden).toBe(true);
  });

  it('renders rows with status tag and fires onOpenConversation on click', () => {
    const onOpen = vi.fn();
    controller!.destroy();
    controller = mount(baseConfig, strings, {
      onSend: () => {},
      onTypingIntent: () => {},
      onOpenConversation: onOpen,
    });
    ($('.launcher')).click();
    const convs: ConversationSummary[] = [
      {
        id: 'ccv_a',
        sessionId: 'sid_a',
        title: 'Refund question',
        preview: 'Thanks — refund processed.',
        status: 'closed',
        handedOver: false,
        lastMessageAt: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
      },
    ];
    controller.setPastConversations(convs);
    const rows = $$('.past-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector('.past-title')?.textContent).toBe('Refund question');
    expect(rows[0]!.querySelector('.tag')?.classList.contains('tag-closed')).toBe(true);
    (rows[0] as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledWith(convs[0]);
  });

  it('hides past list entirely when showHistory is false', () => {
    controller!.destroy();
    controller = mount(
      { ...baseConfig, showHistory: false },
      strings,
      { onSend: () => {}, onTypingIntent: () => {} },
    );
    ($('.launcher')).click();
    controller.setPastConversations([
      {
        id: 'ccv_a',
        sessionId: 'sid_a',
        title: 'x',
        preview: 'y',
        status: 'open',
        handedOver: false,
        lastMessageAt: null,
      },
    ]);
    expect(($('.past')).hidden).toBe(true);
    expect(($('.empty')).hidden).toBe(true);
  });
});

describe('ui: addMessages', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    controller.setView('chat');
  });

  it('renders end_user / agent / system messages with the right classes', () => {
    controller!.addMessages([
      msg({ id: 'm1', role: 'end_user', body: 'hello' }),
      msg({ id: 'm2', role: 'agent', body: 'hi back' }),
      msg({ id: 'm3', role: 'system', body: 'note' }),
    ]);
    const bubbles = $$('[data-message-id]');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]!.classList.contains('mine')).toBe(true);
    expect(bubbles[1]!.classList.contains('theirs')).toBe(true);
    expect($$('.system')).toHaveLength(1);
  });

  it('tags agent messages with the human/AI chip', () => {
    controller!.addMessages([
      { id: 'm1', role: 'agent', body: 'hi', bodyHtml: null, at: '2026-01-01T00:00:00Z', authorKind: 'ai', authorName: 'Munin', readAt: null },
      { id: 'm2', role: 'agent', body: 'taking over', bodyHtml: null, at: '2026-01-01T00:00:01Z', authorKind: 'human', authorName: 'Maja', readAt: null },
    ]);
    const heads = $$('.msg-head');
    const labels = heads.map((h) => h.textContent ?? '');
    expect(labels.some((l) => /Munin/.test(l) && /AI/.test(l))).toBe(true);
    expect(labels.some((l) => /Maja/.test(l) && /human/.test(l))).toBe(true);
  });

  it('dedupes by message id across calls', () => {
    controller!.addMessages([msg({ id: 'm1', role: 'end_user', body: 'hi' })]);
    controller!.addMessages([
      msg({ id: 'm1', role: 'end_user', body: 'hi' }),
      msg({ id: 'm2', role: 'agent', body: 'hello' }),
    ]);
    expect($$('[data-message-id]')).toHaveLength(2);
  });

  it('renders body as text (no HTML injection)', () => {
    controller!.addMessages([
      msg({ id: 'm1', role: 'end_user', body: '<script>alert(1)</script>' }),
    ]);
    const bubble = $('[data-message-id="m1"] .bubble');
    expect(bubble.textContent).toBe('<script>alert(1)</script>');
    expect(bubble.querySelector('script')).toBeNull();
  });
});

describe('ui: handover envelope', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    controller.setView('chat');
  });

  it('flips the chat subtitle when the conversation is handed over to a named human', () => {
    controller!.setConversation({
      id: 'ccv_1',
      subject: null,
      status: 'open',
      handedOver: true,
      assigneeName: 'Maja',
      contactEmail: null,
    });
    expect($('.chat-sub-label').textContent).toMatch(/Maja/);
  });

  it('shows "Online now" in the subtitle when the conversation is AI-handled', () => {
    controller!.setConversation({
      id: 'ccv_1',
      subject: null,
      status: 'open',
      handedOver: false,
      assigneeName: null,
      contactEmail: null,
    });
    expect($('.chat-sub-label').textContent).toMatch(/Online now/);
  });
});

describe('ui: email-save card', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    controller.setView('chat');
  });

  it('appears once after showEmailCard()', () => {
    controller!.showEmailCard();
    expect($$('.card')).toHaveLength(1);
    controller!.showEmailCard();
    expect($$('.card')).toHaveLength(1);
  });

  it('submitting fires onSetVisitorEmail with the entered email', () => {
    const onEmail = vi.fn();
    controller!.destroy();
    controller = mount(baseConfig, strings, {
      onSend: () => {},
      onTypingIntent: () => {},
      onSetVisitorEmail: onEmail,
    });
    ($('.launcher')).click();
    controller.setView('chat');
    controller.showEmailCard();
    const input = $<HTMLInputElement>('.card-form input');
    input.value = 'ada@example.com';
    ($('.card-form')).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(onEmail).toHaveBeenCalledWith('ada@example.com');
  });

  it('flips to "Saved" via setEmailSaved', () => {
    controller!.showEmailCard();
    controller!.setEmailSaved('ada@example.com');
    expect($('.card.card-done')).toBeTruthy();
    expect($('.card-done strong').textContent).toBe('ada@example.com');
  });
});

describe('ui: agent typing', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
    controller.setView('chat');
  });

  it('shows the typing indicator on setAgentTyping(true)', () => {
    controller!.setAgentTyping(true);
    expect(($('.bubble.typing').parentElement as HTMLElement).hidden).toBe(false);
  });

  it('hides on setAgentTyping(false)', () => {
    controller!.setAgentTyping(true);
    controller!.setAgentTyping(false);
    expect(($('.bubble.typing').parentElement as HTMLElement).hidden).toBe(true);
  });

  it('auto-clears after 5 s without a refresh', () => {
    vi.useFakeTimers();
    controller!.setAgentTyping(true);
    expect(($('.bubble.typing').parentElement as HTMLElement).hidden).toBe(false);
    vi.advanceTimersByTime(5100);
    expect(($('.bubble.typing').parentElement as HTMLElement).hidden).toBe(true);
  });
});

describe('ui: composer', () => {
  let onSend: ReturnType<typeof vi.fn<(text: string) => void>>;
  let onTypingIntent: ReturnType<typeof vi.fn<(intent: 'typing' | 'stopped') => void>>;
  beforeEach(() => {
    onSend = vi.fn<(text: string) => void>();
    onTypingIntent = vi.fn<(intent: 'typing' | 'stopped') => void>();
    controller = mount(baseConfig, strings, { onSend, onTypingIntent });
    ($('.launcher')).click();
    controller.setView('chat');
  });

  function setText(s: string): void {
    const ta = $<HTMLTextAreaElement>('textarea');
    ta.value = s;
    ta.dispatchEvent(new Event('input'));
  }

  it('updates the counter as the user types and disables send when empty', () => {
    expect($<HTMLButtonElement>('.send').disabled).toBe(true);
    expect($('.counter').textContent).toBe('0/1000');
    setText('hello');
    expect($('.counter').textContent).toBe('5/1000');
    expect($<HTMLButtonElement>('.send').disabled).toBe(false);
  });

  it('disables send and adds .over when over the 1000-char limit', () => {
    setText('x'.repeat(1001));
    expect($('.counter').classList.contains('over')).toBe(true);
    expect($<HTMLButtonElement>('.send').disabled).toBe(true);
  });

  it('emits onSend on submit and clears the textarea', () => {
    setText('hi there');
    ($('.composer')).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('hi there');
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
  });

  it('does not emit onSend when the field is empty or only whitespace', () => {
    setText('   ');
    ($('.composer')).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('emits onTypingIntent("typing") on input and "stopped" after idle', () => {
    vi.useFakeTimers();
    setText('hi');
    expect(onTypingIntent).toHaveBeenCalledWith('typing');
    vi.advanceTimersByTime(1000);
    expect(onTypingIntent).toHaveBeenCalledWith('stopped');
  });

  it('sends on Enter, not on Shift+Enter', () => {
    setText('hi');
    const ta = $<HTMLTextAreaElement>('textarea');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('hi');
    onSend.mockClear();
    setText('hi2');
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true }),
    );
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('ui: connection state banner', () => {
  beforeEach(() => {
    controller = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher')).click();
  });

  it('shows the reconnecting bar only after the grace period, then hides on connected', () => {
    vi.useFakeTimers();
    controller!.setConnectionState('reconnecting');
    expect(($('.status')).hidden).toBe(true);
    vi.advanceTimersByTime(1400);
    expect(($('.status')).hidden).toBe(true);
    vi.advanceTimersByTime(200);
    expect(($('.status')).hidden).toBe(false);
    expect($('.status').textContent).toMatch(/reconnect/i);
    controller!.setConnectionState('connected');
    expect(($('.status')).hidden).toBe(true);
  });

  it('never shows the bar when a reconnect succeeds within the grace period', () => {
    vi.useFakeTimers();
    controller!.setConnectionState('reconnecting');
    vi.advanceTimersByTime(800);
    controller!.setConnectionState('connecting');
    controller!.setConnectionState('connected');
    expect(($('.status')).hidden).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(($('.status')).hidden).toBe(true);
  });

  it('keeps the grace clock running across reconnecting/connecting bounces', () => {
    vi.useFakeTimers();
    controller!.setConnectionState('reconnecting');
    vi.advanceTimersByTime(1000);
    controller!.setConnectionState('connecting');
    controller!.setConnectionState('reconnecting');
    expect(($('.status')).hidden).toBe(true);
    vi.advanceTimersByTime(600);
    expect(($('.status')).hidden).toBe(false);
  });

  it('shows the disconnected bar immediately on closed', () => {
    controller!.setConnectionState('closed');
    expect(($('.status')).hidden).toBe(false);
    expect($('.status').textContent).toMatch(/disconnect/i);
  });
});
