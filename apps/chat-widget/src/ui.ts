import type { ListedMessage } from './api.js';
import type { WidgetConfig } from './config.js';
import { WIDGET_END_USER_BODY_MAX_CHARS } from './config.js';
import { WIDGET_CSS } from './styles.js';

/**
 * UI controller. The whole tree lives inside an open Shadow DOM root
 * attached to a <div> at the end of the host page's <body>, so the host
 * page's CSS can't bleed in and ours can't bleed out.
 *
 * mount() returns a controller exposing the small surface the widget
 * orchestrator (`widget.ts`) needs: append a batch of messages (deduped
 * by id), toggle the agent-typing indicator, surface a connection-state
 * banner, and tear down on unload.
 *
 * UI events flow back via the `hooks` object — no DOM event listeners
 * leak past this module.
 */

export type ConnectionLabel = 'connected' | 'reconnecting' | 'closed' | 'idle' | 'connecting';

export interface UiHooks {
  onSend: (text: string) => void;
  onTypingIntent: (intent: 'typing' | 'stopped') => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface UiController {
  /** Idempotent batch insert; existing message ids are skipped. */
  addMessages(messages: ListedMessage[]): void;
  setAgentTyping(isTyping: boolean): void;
  setConnectionState(state: ConnectionLabel): void;
  setSending(sending: boolean): void;
  open(): void;
  close(): void;
  destroy(): void;
}

const TYPING_IDLE_MS = 800;

export function mount(config: WidgetConfig, hooks: UiHooks): UiController {
  const host = document.createElement('div');
  host.style.all = 'initial';
  host.setAttribute('data-munin-widget', '');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = WIDGET_CSS;
  shadow.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = 'root';
  root.setAttribute('data-position', config.position);
  root.style.setProperty('--munin-theme', config.themeColor);
  shadow.appendChild(root);

  const launcher = renderLauncher();
  const panel = renderPanel(config);
  root.append(launcher, panel.el);
  panel.el.hidden = true;

  // Render the greeting once when the panel is first opened so it
  // doesn't briefly flash before real messages arrive on backfill.
  let greetingShown = false;
  const showGreeting = () => {
    if (greetingShown) return;
    greetingShown = true;
    const g = document.createElement('div');
    g.className = 'greeting';
    g.textContent = config.greeting;
    panel.messagesEl.appendChild(g);
    scrollToBottom();
  };

  launcher.addEventListener('click', () => {
    open();
  });
  panel.closeBtn.addEventListener('click', () => {
    close();
  });

  const seenIds = new Set<string>();

  function open(): void {
    panel.el.hidden = false;
    launcher.hidden = true;
    showGreeting();
    panel.textarea.focus();
    hooks.onOpen?.();
  }

  function close(): void {
    panel.el.hidden = true;
    launcher.hidden = false;
    setAgentTyping(false);
    hooks.onClose?.();
  }

  function scrollToBottom(): void {
    panel.messagesEl.scrollTop = panel.messagesEl.scrollHeight;
  }

  function addMessages(messages: ListedMessage[]): void {
    let appended = false;
    for (const m of messages) {
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);
      const el = document.createElement('div');
      el.className = `message ${m.role}`;
      el.textContent = m.body;
      el.setAttribute('data-message-id', m.id);
      panel.messagesEl.appendChild(el);
      appended = true;
    }
    if (appended) scrollToBottom();
  }

  let agentTypingTimer: ReturnType<typeof setTimeout> | null = null;
  function setAgentTyping(isTyping: boolean): void {
    if (agentTypingTimer) {
      clearTimeout(agentTypingTimer);
      agentTypingTimer = null;
    }
    panel.typingEl.hidden = !isTyping;
    if (isTyping) {
      // Local safety net: if no follow-up arrives, hide after 5s. The
      // server also auto-clears, but the visitor's WS may have been
      // briefly disconnected when the auto-clear fired.
      agentTypingTimer = setTimeout(() => {
        panel.typingEl.hidden = true;
        agentTypingTimer = null;
      }, 5000);
    }
    if (isTyping) scrollToBottom();
  }

  function setConnectionState(state: ConnectionLabel): void {
    if (state === 'connected' || state === 'idle' || state === 'connecting') {
      panel.statusEl.hidden = true;
      panel.statusEl.textContent = '';
    } else if (state === 'reconnecting') {
      panel.statusEl.hidden = false;
      panel.statusEl.textContent = 'Reconnecting…';
    } else if (state === 'closed') {
      panel.statusEl.hidden = false;
      panel.statusEl.textContent = 'Disconnected.';
    }
  }

  function setSending(sending: boolean): void {
    panel.sendBtn.disabled = sending || !canSend();
    panel.textarea.disabled = sending;
  }

  function canSend(): boolean {
    const v = panel.textarea.value.trim();
    return v.length > 0 && v.length <= WIDGET_END_USER_BODY_MAX_CHARS;
  }

  function refreshComposerState(): void {
    const len = panel.textarea.value.length;
    panel.counterEl.textContent = `${len}/${WIDGET_END_USER_BODY_MAX_CHARS}`;
    panel.counterEl.classList.toggle('over', len > WIDGET_END_USER_BODY_MAX_CHARS);
    panel.sendBtn.disabled = !canSend();
  }
  refreshComposerState();

  let typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
  function bumpTypingIntent(): void {
    hooks.onTypingIntent('typing');
    if (typingIdleTimer) clearTimeout(typingIdleTimer);
    typingIdleTimer = setTimeout(() => {
      hooks.onTypingIntent('stopped');
      typingIdleTimer = null;
    }, TYPING_IDLE_MS);
  }

  panel.textarea.addEventListener('input', () => {
    refreshComposerState();
    if (panel.textarea.value.trim().length > 0) bumpTypingIntent();
  });
  panel.textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  panel.form.addEventListener('submit', (e) => {
    e.preventDefault();
    doSend();
  });

  function doSend(): void {
    const text = panel.textarea.value.trim();
    if (!canSend()) return;
    panel.textarea.value = '';
    refreshComposerState();
    if (typingIdleTimer) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }
    hooks.onTypingIntent('stopped');
    hooks.onSend(text);
  }

  function destroy(): void {
    if (agentTypingTimer) clearTimeout(agentTypingTimer);
    if (typingIdleTimer) clearTimeout(typingIdleTimer);
    host.remove();
  }

  return {
    addMessages,
    setAgentTyping,
    setConnectionState,
    setSending,
    open,
    close,
    destroy,
  };
}

function renderLauncher(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'launcher';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>';
  return btn;
}

interface PanelHandles {
  el: HTMLDivElement;
  closeBtn: HTMLButtonElement;
  statusEl: HTMLDivElement;
  messagesEl: HTMLDivElement;
  typingEl: HTMLDivElement;
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  counterEl: HTMLSpanElement;
  sendBtn: HTMLButtonElement;
}

function renderPanel(config: WidgetConfig): PanelHandles {
  const el = document.createElement('div');
  el.className = 'panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', config.title);

  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('span');
  title.textContent = config.title;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close chat');
  closeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  header.append(title, closeBtn);

  const statusEl = document.createElement('div');
  statusEl.className = 'status';
  statusEl.hidden = true;

  const messagesEl = document.createElement('div');
  messagesEl.className = 'messages';

  const typingEl = document.createElement('div');
  typingEl.className = 'typing';
  typingEl.hidden = true;
  typingEl.setAttribute('aria-label', 'Agent is typing');
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  messagesEl.appendChild(typingEl);

  const form = document.createElement('form');
  form.className = 'composer';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.placeholder = 'Type a message…';
  textarea.maxLength = WIDGET_END_USER_BODY_MAX_CHARS + 200;
  textarea.setAttribute('aria-label', 'Message');

  const row = document.createElement('div');
  row.className = 'composer-row';
  const counterEl = document.createElement('span');
  counterEl.className = 'counter';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'send';
  sendBtn.textContent = 'Send';
  sendBtn.disabled = true;
  row.append(counterEl, sendBtn);

  form.append(textarea, row);

  el.append(header, statusEl, messagesEl, form);

  return { el, closeBtn, statusEl, messagesEl, typingEl, form, textarea, counterEl, sendBtn };
}
