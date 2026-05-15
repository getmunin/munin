import type { ConversationEnvelope, ConversationSummary, ListedMessage } from './api.js';
import type { WidgetConfig } from './config.js';
import { WIDGET_END_USER_BODY_MAX_CHARS } from './config.js';
import { buildWidgetCss } from './styles.js';
import { registerBundledFonts } from './fonts.js';
import type { Strings } from './strings/index.js';
import { renderMarkdownInto } from './markdown.js';

export type ConnectionLabel = 'connected' | 'reconnecting' | 'closed' | 'idle' | 'connecting';

export interface UiHooks {
  onSend: (text: string) => void;
  onTypingIntent: (intent: 'typing' | 'stopped') => void;
  onOpen?: () => void;
  onClose?: () => void;
  onStartConversation?: () => void;
  onOpenConversation?: (summary: ConversationSummary) => void;
  onBackToWelcome?: () => void;
  onSetVisitorEmail?: (email: string) => void;
  onMessageRead?: (messageId: string) => void;
}

export type ChatKind = 'new' | 'existing';

export interface UiController {
  addMessages(messages: ListedMessage[]): void;
  setAgentTyping(isTyping: boolean): void;
  setConnectionState(state: ConnectionLabel): void;
  setSending(sending: boolean): void;
  setPastConversations(convs: ConversationSummary[]): void;
  setConversation(envelope: ConversationEnvelope | null): void;
  setLauncherUnread(count: number): void;
  showEmailCard(): void;
  setEmailSaved(email: string): void;
  setView(view: 'welcome' | 'chat'): void;
  setChatKind(kind: ChatKind): void;
  resetChat(): void;
  open(): void;
  close(): void;
  destroy(): void;
}

const TYPING_IDLE_MS = 800;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function mount(config: WidgetConfig, strings: Strings, hooks: UiHooks): UiController {
  if (config.fonts === 'bundled') registerBundledFonts();
  const host = document.createElement('div');
  host.style.all = 'initial';
  host.setAttribute('data-munin-widget', '');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = buildWidgetCss(config.fonts);
  shadow.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = 'root';
  root.setAttribute('data-position', config.position);
  root.setAttribute('data-size', config.size);
  root.style.setProperty('--munin-theme', config.themeColor);
  shadow.appendChild(root);

  const { btn: launcher, badge: launcherBadge } = renderLauncher(strings);
  const panel = renderPanel(config, strings);
  root.append(launcher, panel.el);
  panel.el.hidden = true;

  let view: 'welcome' | 'chat' = 'welcome';
  let pastConvs: ConversationSummary[] = [];
  let conversationEnvelope: ConversationEnvelope | null = null;
  let chatKind: ChatKind = 'new';
  let emailCardEl: HTMLDivElement | null = null;
  let emailSaved: { email: string } | null = null;

  const seenIds = new Set<string>();
  const readReported = new Set<string>();
  const readObserver: IntersectionObserver | null =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const id = (entry.target as HTMLElement).getAttribute('data-message-id');
              if (!id || readReported.has(id)) continue;
              readReported.add(id);
              readObserver?.unobserve(entry.target);
              hooks.onMessageRead?.(id);
            }
          },
          { root: panel.messagesEl, threshold: 0.5 },
        )
      : null;

  launcher.addEventListener('click', () => open());
  panel.closeBtn.addEventListener('click', () => close());
  panel.backBtn.addEventListener('click', () => {
    hooks.onBackToWelcome?.();
    setView('welcome');
  });
  panel.startBtn.addEventListener('click', () => {
    hooks.onStartConversation?.();
  });

  function open(): void {
    panel.el.hidden = false;
    requestAnimationFrame(() => panel.el.classList.add('open'));
    launcher.hidden = true;
    if (view === 'chat') {
      panel.textarea.focus();
    }
    hooks.onOpen?.();
  }

  function close(): void {
    panel.el.classList.remove('open');
    launcher.hidden = false;
    setAgentTyping(false);
    setTimeout(() => {
      if (!panel.el.classList.contains('open')) panel.el.hidden = true;
    }, 220);
    hooks.onClose?.();
  }

  function scrollToBottom(): void {
    panel.messagesEl.scrollTop = panel.messagesEl.scrollHeight;
  }

  function setView(next: 'welcome' | 'chat'): void {
    view = next;
    panel.welcomeEl.hidden = next !== 'welcome';
    panel.chatEl.hidden = next !== 'chat';
    if (next === 'chat') {
      panel.textarea.focus();
      scrollToBottom();
    }
  }

  function addMessages(messages: ListedMessage[]): void {
    let appended = false;
    for (const m of messages) {
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);
      const el = renderMessage(m, strings);
      panel.messagesEl.appendChild(el);
      if (readObserver && m.role !== 'end_user' && m.role !== 'system') {
        readObserver.observe(el);
      }
      appended = true;
    }
    if (panel.typingEl.parentNode === panel.messagesEl) {
      panel.messagesEl.appendChild(panel.typingEl);
    }
    if (appended) scrollToBottom();
  }

  function setPastConversations(convs: ConversationSummary[]): void {
    pastConvs = convs;
    renderPastList(panel.pastListEl, panel.emptyEl, panel.sectionHeadEl, pastConvs, (c) => {
      hooks.onOpenConversation?.(c);
    }, config.showHistory, strings);
  }

  function setConversation(envelope: ConversationEnvelope | null): void {
    conversationEnvelope = envelope;
    paintChatHead();
  }

  function paintChatHead(): void {
    const env = conversationEnvelope;
    const handedOver = !!env?.handedOver;
    const sub = handedOver
      ? `${env?.assigneeName ?? strings.defaultTeammateName} · ${strings.typicallyReplies}`
      : strings.onlineNow;
    const defaultTitle = chatKind === 'new' ? strings.newConversation : strings.conversation;
    panel.chatTitle.textContent = env?.subject ?? defaultTitle;
    panel.chatSubLabel.textContent = sub;
  }

  let agentTypingTimer: ReturnType<typeof setTimeout> | null = null;
  function setAgentTyping(isTyping: boolean): void {
    if (agentTypingTimer) {
      clearTimeout(agentTypingTimer);
      agentTypingTimer = null;
    }
    panel.typingEl.hidden = !isTyping;
    if (isTyping) {
      agentTypingTimer = setTimeout(() => {
        panel.typingEl.hidden = true;
        agentTypingTimer = null;
      }, 5000);
      scrollToBottom();
    }
  }

  let connectionDisabled = false;
  let sendingNow = false;

  function setConnectionState(state: ConnectionLabel): void {
    if (state === 'connected' || state === 'idle' || state === 'connecting') {
      panel.statusEl.hidden = true;
      panel.statusEl.textContent = '';
      connectionDisabled = false;
    } else if (state === 'reconnecting') {
      panel.statusEl.hidden = false;
      panel.statusEl.textContent = strings.statusReconnecting;
      connectionDisabled = true;
    } else if (state === 'closed') {
      panel.statusEl.hidden = false;
      panel.statusEl.textContent = strings.statusDisconnected;
      connectionDisabled = true;
    }
    refreshComposerState();
  }

  function setSending(sending: boolean): void {
    sendingNow = sending;
    refreshComposerState();
  }

  function canSend(): boolean {
    const v = panel.textarea.value.trim();
    return v.length > 0 && v.length <= WIDGET_END_USER_BODY_MAX_CHARS;
  }

  function refreshComposerState(): void {
    const len = panel.textarea.value.length;
    panel.counterEl.textContent = `${len}/${WIDGET_END_USER_BODY_MAX_CHARS}`;
    panel.counterEl.classList.toggle('over', len > WIDGET_END_USER_BODY_MAX_CHARS);
    const composerLocked = connectionDisabled || sendingNow;
    panel.textarea.disabled = composerLocked;
    const enabled = canSend() && !composerLocked;
    panel.sendBtn.disabled = !enabled;
    panel.sendBtn.classList.toggle('active', enabled);
  }
  refreshComposerState();

  function resetChat(): void {
    seenIds.clear();
    readReported.clear();
    readObserver?.disconnect();
    panel.messagesEl.innerHTML = '';
    panel.messagesEl.appendChild(panel.typingEl);
    panel.typingEl.hidden = true;
    emailCardEl = null;
    emailSaved = null;
    conversationEnvelope = null;
    paintChatHead();
  }

  function setChatKind(kind: ChatKind): void {
    chatKind = kind;
    paintChatHead();
  }

  function showEmailCard(): void {
    if (emailCardEl || emailSaved) return;
    emailCardEl = renderEmailCard(strings, {
      onSubmit: (email) => {
        if (!EMAIL_RE.test(email)) return;
        hooks.onSetVisitorEmail?.(email);
      },
      onDismiss: () => {
        emailCardEl?.remove();
        emailCardEl = null;
      },
    });
    panel.messagesEl.appendChild(emailCardEl);
    if (panel.typingEl.parentNode === panel.messagesEl) {
      panel.messagesEl.appendChild(panel.typingEl);
    }
    scrollToBottom();
  }

  function setEmailSaved(email: string): void {
    emailSaved = { email };
    if (!emailCardEl) return;
    const replacement = renderEmailCardDone(strings, email);
    emailCardEl.replaceWith(replacement);
    emailCardEl = replacement;
  }

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
    autoGrow(panel.textarea);
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
    autoGrow(panel.textarea);
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
    readObserver?.disconnect();
    host.remove();
  }

  if (config.eyebrow === null) {
    panel.welcomeEyebrowEl.innerHTML = `<a href="https://getmunin.com" target="_blank" rel="noopener noreferrer">${escapeHtml(strings.poweredBy)} <strong>Munin</strong></a>`;
  } else {
    panel.welcomeEyebrowEl.textContent = config.eyebrow;
  }
  panel.welcomeH1.innerHTML = renderGreeting(config.greeting ?? strings.defaultGreeting);
  setPastConversations([]);
  paintChatHead();

  function setLauncherUnread(count: number): void {
    if (count <= 0) {
      launcherBadge.hidden = true;
      launcherBadge.textContent = '';
      return;
    }
    launcherBadge.hidden = false;
    launcherBadge.textContent = count > 9 ? '9+' : String(count);
  }

  return {
    addMessages,
    setAgentTyping,
    setConnectionState,
    setSending,
    setPastConversations,
    setConversation,
    setLauncherUnread,
    showEmailCard,
    setEmailSaved,
    setView,
    setChatKind,
    resetChat,
    open,
    close,
    destroy,
  };
}

function renderGreeting(raw: string): string {
  const trimmed = raw.trim();
  const m = /^(.*?[.?!])\s+(.+)$/.exec(trimmed);
  if (m) return `${escapeHtml(m[1]!)} <em>${escapeHtml(m[2]!)}</em>`;
  return escapeHtml(trimmed);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function escapeAttr(s: string): string {
  return s.replace(/[&"<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : '&gt;',
  );
}

function renderMessage(m: ListedMessage, strings: Strings): HTMLElement {
  if (m.role === 'system') {
    const el = document.createElement('div');
    el.className = 'system';
    el.innerHTML = '<span class="system-line"></span><span class="system-text"></span><span class="system-line"></span>';
    (el.querySelector('.system-text') as HTMLElement).textContent = m.body;
    return el;
  }
  const wrap = document.createElement('div');
  const mine = m.role === 'end_user';
  wrap.className = `msg ${mine ? 'mine' : 'theirs'}`;
  wrap.setAttribute('data-message-id', m.id);

  if (!mine) {
    const head = document.createElement('div');
    head.className = 'msg-head';
    const who = document.createElement('span');
    who.className = 'msg-who';
    who.textContent = m.authorName ?? strings.defaultAuthorName;
    head.appendChild(who);
    if (m.authorKind === 'ai' || m.authorKind === 'human') {
      const role = document.createElement('span');
      role.className = 'msg-role';
      role.textContent = `· ${m.authorKind === 'ai' ? strings.roleAi : strings.roleHuman}`;
      head.appendChild(role);
    }
    const t = document.createElement('span');
    t.className = 'msg-t';
    t.textContent = `· ${formatTime(m.at)}`;
    head.appendChild(t);
    wrap.appendChild(head);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (mine) {
    bubble.textContent = m.body;
  } else {
    renderMarkdownInto(bubble, m.body);
  }
  wrap.appendChild(bubble);
  if (mine) {
    const t = document.createElement('div');
    t.className = 'msg-t mine';
    t.textContent = formatTime(m.at);
    wrap.appendChild(t);
  }
  return wrap;
}

function renderPastList(
  listEl: HTMLUListElement,
  emptyEl: HTMLDivElement,
  sectionHeadEl: HTMLDivElement,
  convs: ConversationSummary[],
  onClick: (c: ConversationSummary) => void,
  showHistory: boolean,
  strings: Strings,
): void {
  listEl.innerHTML = '';
  if (!showHistory) {
    listEl.hidden = true;
    emptyEl.hidden = true;
    sectionHeadEl.hidden = true;
    return;
  }
  if (convs.length === 0) {
    listEl.hidden = true;
    sectionHeadEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  sectionHeadEl.hidden = false;
  (sectionHeadEl.querySelector('.section-meta') as HTMLElement).textContent = String(convs.length);
  listEl.hidden = false;
  for (const c of convs) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'past-row';
    btn.addEventListener('click', () => onClick(c));

    const text = document.createElement('div');
    text.className = 'past-text';
    const title = document.createElement('div');
    title.className = 'past-title';
    title.textContent = c.title;
    const preview = document.createElement('div');
    preview.className = 'past-preview';
    preview.textContent = c.preview;
    text.append(title, preview);

    const meta = document.createElement('div');
    meta.className = 'past-meta';
    const tag = document.createElement('span');
    tag.className = `tag tag-${statusTag(c.status)}`;
    tag.textContent = statusTag(c.status);
    const when = document.createElement('span');
    when.className = 'past-when';
    when.textContent = c.lastMessageAt ? formatRelative(c.lastMessageAt, strings) : '';
    meta.append(tag, when);

    btn.append(text, meta);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

function renderEmailCard(
  strings: Strings,
  opts: { onSubmit: (email: string) => void; onDismiss: () => void },
): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'card';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'card-eyebrow';
  eyebrow.textContent = strings.saveThreadEyebrow;
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = strings.saveThreadBlurb;
  const form = document.createElement('form');
  form.className = 'card-form';
  const input = document.createElement('input');
  input.type = 'email';
  input.placeholder = strings.emailPlaceholder;
  input.autocomplete = 'email';
  input.required = true;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = strings.saveThreadCta;
  form.append(input, submit);
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'card-skip';
  skip.textContent = strings.saveThreadSkip;
  card.append(eyebrow, title, form, skip);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (v) opts.onSubmit(v);
  });
  skip.addEventListener('click', () => opts.onDismiss());
  return card;
}

function renderEmailCardDone(strings: Strings, email: string): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'card card-done';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'card-eyebrow';
  eyebrow.textContent = strings.saveThreadDoneEyebrow;
  const title = document.createElement('div');
  title.className = 'card-title';
  const [before, after = ''] = strings.saveThreadDoneTemplate.split('{email}');
  title.appendChild(document.createTextNode(before ?? ''));
  const strong = document.createElement('strong');
  strong.textContent = email;
  title.appendChild(strong);
  title.appendChild(document.createTextNode(after));
  card.append(eyebrow, title);
  return card;
}

function renderLauncher(strings: Strings): { btn: HTMLButtonElement; badge: HTMLSpanElement } {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'launcher';
  btn.setAttribute('aria-label', strings.launcherAriaLabel);
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" /></svg>';
  const badge = document.createElement('span');
  badge.className = 'launcher-badge';
  badge.hidden = true;
  btn.appendChild(badge);
  return { btn, badge };
}

interface PanelHandles {
  el: HTMLDivElement;
  closeBtn: HTMLButtonElement;
  backBtn: HTMLButtonElement;
  startBtn: HTMLButtonElement;
  statusEl: HTMLDivElement;
  welcomeEl: HTMLDivElement;
  welcomeEyebrowEl: HTMLDivElement;
  welcomeH1: HTMLHeadingElement;
  sectionHeadEl: HTMLDivElement;
  pastListEl: HTMLUListElement;
  emptyEl: HTMLDivElement;
  chatEl: HTMLDivElement;
  chatTitle: HTMLDivElement;
  chatSubLabel: HTMLSpanElement;
  messagesEl: HTMLDivElement;
  typingEl: HTMLDivElement;
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  counterEl: HTMLSpanElement;
  sendBtn: HTMLButtonElement;
}

function renderPanel(config: WidgetConfig, strings: Strings): PanelHandles {
  const el = document.createElement('div');
  el.className = 'panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', config.title ?? strings.defaultTitle);

  const header = document.createElement('div');
  header.className = 'panel-head';
  header.innerHTML = `
    <div class="panel-head-left">
      <div class="panel-head-mark">
        <svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
        </svg>
      </div>
      <div class="panel-head-text">
        <div class="panel-head-org"></div>
      </div>
    </div>
    <div class="panel-head-right">
      <button type="button" class="icon-btn" data-act="close" aria-label="${escapeAttr(strings.closeAriaLabel)}">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  `;
  (header.querySelector('.panel-head-org') as HTMLElement).textContent =
    config.title ?? strings.defaultTitle;
  const closeBtn = header.querySelector('[data-act="close"]') as HTMLButtonElement;

  const statusEl = document.createElement('div');
  statusEl.className = 'status';
  statusEl.hidden = true;

  const body = document.createElement('div');
  body.className = 'panel-body';

  const welcomeEl = document.createElement('div');
  welcomeEl.className = 'screen welcome';
  welcomeEl.innerHTML = `
    <div class="welcome-eyebrow"></div>
    <h2 class="welcome-h1"></h2>
    <div class="welcome-status">
      <span class="welcome-status-dot"></span>
      <span class="welcome-status-text">${strings.welcomeRepliesAboutHtml}</span>
    </div>
    <button type="button" class="cta" data-act="start">
      <span class="cta-label">
        <span class="cta-eyebrow"></span>
        <span class="cta-sub"></span>
      </span>
      <span class="cta-arrow">→</span>
    </button>
    <div class="section-head" hidden>
      <span class="section-label"></span>
      <span class="section-meta">0</span>
    </div>
    <ul class="past" hidden></ul>
    <div class="empty" hidden>
      <div class="empty-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
        </svg>
      </div>
      <div class="empty-title"></div>
      <div class="empty-sub"></div>
    </div>
  `;
  (welcomeEl.querySelector('.cta-eyebrow') as HTMLElement).textContent = strings.startConversationLabel;
  (welcomeEl.querySelector('.cta-sub') as HTMLElement).textContent = strings.startConversationSub;
  (welcomeEl.querySelector('.section-label') as HTMLElement).textContent = strings.conversationsHeader;
  (welcomeEl.querySelector('.empty-title') as HTMLElement).textContent = strings.emptyConversationsTitle;
  (welcomeEl.querySelector('.empty-sub') as HTMLElement).textContent = strings.emptyConversationsSub;
  const welcomeEyebrowEl = welcomeEl.querySelector('.welcome-eyebrow') as HTMLDivElement;
  const welcomeH1 = welcomeEl.querySelector('.welcome-h1') as HTMLHeadingElement;
  const startBtn = welcomeEl.querySelector('[data-act="start"]') as HTMLButtonElement;
  const sectionHeadEl = welcomeEl.querySelector('.section-head') as HTMLDivElement;
  const pastListEl = welcomeEl.querySelector('.past') as HTMLUListElement;
  const emptyEl = welcomeEl.querySelector('.empty') as HTMLDivElement;

  const chatEl = document.createElement('div');
  chatEl.className = 'screen chat';
  chatEl.hidden = true;
  chatEl.innerHTML = `
    <div class="chat-head">
      <button type="button" class="back-btn" aria-label="${escapeAttr(strings.backAriaLabel)}">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <div class="chat-head-text">
        <div class="chat-title"></div>
        <div class="chat-sub"><span class="chat-sub-dot"></span><span class="chat-sub-label"></span></div>
      </div>
    </div>
    <div class="messages"></div>
    <form class="composer">
      <textarea rows="1" placeholder="${escapeAttr(strings.composerPlaceholder)}" aria-label="${escapeAttr(strings.messageAriaLabel)}"></textarea>
      <div class="composer-row">
        <button type="submit" class="send" aria-label="${escapeAttr(strings.sendAriaLabel)}" disabled>
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
        <span class="counter"></span>
      </div>
    </form>
    <div class="footer-credit"><a href="https://getmunin.com" target="_blank" rel="noopener noreferrer">${escapeHtml(strings.poweredBy)} <strong>Munin</strong></a></div>
  `;
  const backBtn = chatEl.querySelector('.back-btn') as HTMLButtonElement;
  const chatTitle = chatEl.querySelector('.chat-title') as HTMLDivElement;
  const chatSubLabel = chatEl.querySelector('.chat-sub-label') as HTMLSpanElement;
  const messagesEl = chatEl.querySelector('.messages') as HTMLDivElement;
  const form = chatEl.querySelector('form') as HTMLFormElement;
  const textarea = form.querySelector('textarea') as HTMLTextAreaElement;
  textarea.maxLength = WIDGET_END_USER_BODY_MAX_CHARS + 200;
  const counterEl = chatEl.querySelector('.counter') as HTMLSpanElement;
  const sendBtn = chatEl.querySelector('.send') as HTMLButtonElement;

  const typingEl = document.createElement('div');
  typingEl.className = 'msg theirs';
  typingEl.hidden = true;
  typingEl.setAttribute('aria-label', strings.agentTypingAriaLabel);
  typingEl.innerHTML =
    '<div class="bubble typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(typingEl);

  body.append(welcomeEl, chatEl);
  el.append(header, statusEl, body);

  return {
    el,
    closeBtn,
    backBtn,
    startBtn,
    statusEl,
    welcomeEl,
    welcomeEyebrowEl,
    welcomeH1,
    sectionHeadEl,
    pastListEl,
    emptyEl,
    chatEl,
    chatTitle,
    chatSubLabel,
    messagesEl,
    typingEl,
    form,
    textarea,
    counterEl,
    sendBtn,
  };
}

function statusTag(status: string): 'open' | 'closed' | 'snoozed' {
  if (status === 'closed') return 'closed';
  if (status === 'snoozed') return 'snoozed';
  return 'open';
}

function autoGrow(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRelative(iso: string, strings: Strings): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return strings.timeNow;
  if (min < 60) return strings.timeMin.replace('{n}', String(min));
  const hr = Math.round(min / 60);
  if (hr < 24) return strings.timeHour.replace('{n}', String(hr));
  const day = Math.round(hr / 24);
  if (day < 7) return strings.timeDay.replace('{n}', String(day));
  const wk = Math.round(day / 7);
  if (wk < 6) return strings.timeWeek.replace('{n}', String(wk));
  const mo = Math.round(day / 30);
  return strings.timeMonth.replace('{n}', String(mo));
}
