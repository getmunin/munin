import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, type UiController } from './ui.js';
import type { WidgetConfig } from './config.js';

const baseConfig: WidgetConfig = {
  host: 'https://munin.example',
  widgetKey: 'mn_widget_abc',
  channelId: 'cnv_chan',
  themeColor: '#10b981',
  position: 'bottom-right',
  greeting: 'Hi!',
  title: 'Chat',
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

function $<T extends Element = Element>(selector: string): T {
  const el = shadowRoot().querySelector(selector);
  if (!el) throw new Error(`no element matched ${selector}`);
  return el as T;
}

function $$(selector: string): Element[] {
  return Array.from(shadowRoot().querySelectorAll(selector));
}

describe('ui: mount + lifecycle', () => {
  it('attaches an open Shadow DOM host to document.body and renders the launcher hidden by default', () => {
    controller = mount(baseConfig, { onSend: () => {}, onTypingIntent: () => {} });
    const host = document.querySelector('[data-munin-widget]') as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
    const launcher = $('.launcher') as HTMLButtonElement;
    const panel = $('.panel') as HTMLDivElement;
    expect(launcher.hidden).toBe(false);
    expect(panel.hidden).toBe(true);
  });

  it('opens the panel on launcher click and shows the greeting once', () => {
    const onOpen = vi.fn();
    controller = mount(baseConfig, { onSend: () => {}, onTypingIntent: () => {}, onOpen });
    ($('.launcher') as HTMLButtonElement).click();
    expect(($('.panel') as HTMLDivElement).hidden).toBe(false);
    expect(($('.launcher') as HTMLButtonElement).hidden).toBe(true);
    expect($('.greeting').textContent).toBe('Hi!');
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Reopen — greeting should not be appended again.
    ($('.close') as HTMLButtonElement).click();
    ($('.launcher') as HTMLButtonElement).click();
    expect($$('.greeting')).toHaveLength(1);
  });

  it('destroy() removes the host element', () => {
    controller = mount(baseConfig, { onSend: () => {}, onTypingIntent: () => {} });
    expect(document.querySelector('[data-munin-widget]')).not.toBeNull();
    controller.destroy();
    controller = null;
    expect(document.querySelector('[data-munin-widget]')).toBeNull();
  });
});

describe('ui: addMessages', () => {
  beforeEach(() => {
    controller = mount(baseConfig, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher') as HTMLButtonElement).click();
  });

  it('appends end_user / agent / system messages with role classes', () => {
    controller!.addMessages([
      { id: 'm1', role: 'end_user', body: 'hello', bodyHtml: null, at: '2026-01-01T00:00:00Z' },
      { id: 'm2', role: 'agent', body: 'hi back', bodyHtml: null, at: '2026-01-01T00:00:01Z' },
      { id: 'm3', role: 'system', body: 'note', bodyHtml: null, at: '2026-01-01T00:00:02Z' },
    ]);
    const messages = $$('.message');
    expect(messages).toHaveLength(3);
    expect(messages[0]!.classList.contains('end_user')).toBe(true);
    expect(messages[1]!.classList.contains('agent')).toBe(true);
    expect(messages[2]!.classList.contains('system')).toBe(true);
  });

  it('dedupes by message id across calls', () => {
    controller!.addMessages([
      { id: 'm1', role: 'end_user', body: 'hi', bodyHtml: null, at: '2026-01-01T00:00:00Z' },
    ]);
    controller!.addMessages([
      { id: 'm1', role: 'end_user', body: 'hi', bodyHtml: null, at: '2026-01-01T00:00:00Z' },
      { id: 'm2', role: 'agent', body: 'hello', bodyHtml: null, at: '2026-01-01T00:00:01Z' },
    ]);
    expect($$('.message')).toHaveLength(2);
  });

  it('renders body text content (no HTML injection)', () => {
    controller!.addMessages([
      {
        id: 'm1',
        role: 'end_user',
        body: '<script>alert(1)</script>',
        bodyHtml: null,
        at: '2026-01-01T00:00:00Z',
      },
    ]);
    const m = $('.message') as HTMLElement;
    expect(m.textContent).toBe('<script>alert(1)</script>');
    expect(m.querySelector('script')).toBeNull();
  });
});

describe('ui: agent typing', () => {
  beforeEach(() => {
    controller = mount(baseConfig, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher') as HTMLButtonElement).click();
  });

  it('shows the typing indicator on setAgentTyping(true)', () => {
    controller!.setAgentTyping(true);
    expect(($('.typing') as HTMLElement).hidden).toBe(false);
  });

  it('hides on setAgentTyping(false)', () => {
    controller!.setAgentTyping(true);
    controller!.setAgentTyping(false);
    expect(($('.typing') as HTMLElement).hidden).toBe(true);
  });

  it('auto-clears after 5 s without a refresh', () => {
    vi.useFakeTimers();
    controller!.setAgentTyping(true);
    expect(($('.typing') as HTMLElement).hidden).toBe(false);
    vi.advanceTimersByTime(5100);
    expect(($('.typing') as HTMLElement).hidden).toBe(true);
  });

  it('refreshing the indicator within 5 s extends the auto-clear', () => {
    vi.useFakeTimers();
    controller!.setAgentTyping(true);
    vi.advanceTimersByTime(3000);
    controller!.setAgentTyping(true); // refresh
    vi.advanceTimersByTime(3000);
    expect(($('.typing') as HTMLElement).hidden).toBe(false);
    vi.advanceTimersByTime(2200);
    expect(($('.typing') as HTMLElement).hidden).toBe(true);
  });
});

describe('ui: composer', () => {
  let onSend: ReturnType<typeof vi.fn>;
  let onTypingIntent: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onSend = vi.fn();
    onTypingIntent = vi.fn();
    controller = mount(baseConfig, { onSend, onTypingIntent });
    ($('.launcher') as HTMLButtonElement).click();
  });

  function setText(s: string): void {
    const ta = $('textarea') as HTMLTextAreaElement;
    ta.value = s;
    ta.dispatchEvent(new Event('input'));
  }

  it('updates the counter as the user types and disables send when empty', () => {
    expect(($('.send') as HTMLButtonElement).disabled).toBe(true);
    expect($('.counter').textContent).toBe('0/1000');
    setText('hello');
    expect($('.counter').textContent).toBe('5/1000');
    expect(($('.send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables send and adds .over class when over the 1000-char limit', () => {
    setText('x'.repeat(1001));
    expect($('.counter').classList.contains('over')).toBe(true);
    expect(($('.send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits onSend on submit and clears the textarea', () => {
    setText('hi there');
    ($('.composer') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }),
    );
    expect(onSend).toHaveBeenCalledWith('hi there');
    expect(($('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('does not emit onSend when the field is empty or only whitespace', () => {
    setText('   ');
    ($('.composer') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }),
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it('emits onTypingIntent("typing") on input and onTypingIntent("stopped") after idle', () => {
    vi.useFakeTimers();
    setText('hi');
    expect(onTypingIntent).toHaveBeenCalledWith('typing');
    vi.advanceTimersByTime(1000);
    expect(onTypingIntent).toHaveBeenCalledWith('stopped');
  });

  it('stops typing intent and emits onSend on Enter (without Shift)', () => {
    setText('hi');
    const ta = $('textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('does not send on Shift+Enter (newline)', () => {
    setText('hi');
    const ta = $('textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true }),
    );
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('ui: connection state banner', () => {
  beforeEach(() => {
    controller = mount(baseConfig, { onSend: () => {}, onTypingIntent: () => {} });
    ($('.launcher') as HTMLButtonElement).click();
  });

  it('hides the banner on connected / idle / connecting', () => {
    controller!.setConnectionState('reconnecting');
    expect(($('.status') as HTMLElement).hidden).toBe(false);
    controller!.setConnectionState('connected');
    expect(($('.status') as HTMLElement).hidden).toBe(true);
  });

  it('shows "Reconnecting…" while reconnecting', () => {
    controller!.setConnectionState('reconnecting');
    expect($('.status').textContent).toMatch(/reconnect/i);
  });
});
