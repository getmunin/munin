import { parseConfig, type WidgetConfig } from './config.ts';
import {
  getRecentSessionIds,
  getSessionId,
  getVisitorId,
  mintNewSession,
  setCurrentSession,
} from './session.ts';
import {
  createApiClient,
  WidgetApiError,
  type ConversationEnvelope,
  type ConversationSummary,
  type ListedMessage,
} from './api.ts';
import { createRealtimeClient, type IncomingTyping } from './realtime.ts';
import { mount, type UiController } from './ui.ts';
import { pickLocale } from './strings/index.ts';
import { createVoiceSession, type VoiceSession } from '@getmunin/widget-voice';

function bootstrap(): void {
  const scriptEl = currentScript();
  if (!scriptEl) return;
  const result = parseConfig(scriptEl);
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`[munin-widget] ${err.attr}: ${err.message}`);
    }
    return;
  }
  for (const w of result.warnings) {
    console.warn(`[munin-widget] ${w.attr}: ${w.message}`);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => start(result.config), { once: true });
  } else {
    start(result.config);
  }
}

function start(config: WidgetConfig): void {
  let sessionId = getSessionId(config.channelId);
  const visitorId = getVisitorId(config.channelId);
  const identity =
    config.externalId && config.userHash
      ? { externalId: config.externalId, userHash: config.userHash }
      : undefined;
  const api = createApiClient({
    host: config.host,
    widgetKey: config.widgetKey,
    channelId: config.channelId,
    sessionId,
    visitorId,
    identity,
    visitor: config.visitor,
    locale: pickLocale(config.locale).locale,
  });
  const realtime = createRealtimeClient({
    host: config.host,
    widgetKey: config.widgetKey,
    channelId: config.channelId,
    sessionId,
    identity,
  });

  let lastSeenAt: Date | undefined;
  let backfillInFlight = false;
  let backfillPending = false;
  let agentTurnsThisSession = 0;
  let visitorHasEmail = !!config.visitor?.email;
  let emailCardShown = false;
  const messagesById = new Map<string, ListedMessage>();
  const locallyRead = new Set<string>();

  function recordMessages(messages: ListedMessage[]): void {
    for (const m of messages) messagesById.set(m.id, m);
    refreshUnreadBadge();
  }

  function markLocallyRead(messageId: string): void {
    locallyRead.add(messageId);
    refreshUnreadBadge();
  }

  function refreshUnreadBadge(): void {
    let n = 0;
    for (const m of messagesById.values()) {
      if (m.role !== 'agent') continue;
      if (m.readAt) continue;
      if (locallyRead.has(m.id)) continue;
      n += 1;
    }
    ui.setLauncherUnread(n);
  }

  async function backfill(): Promise<void> {
    if (backfillInFlight) {
      backfillPending = true;
      return;
    }
    backfillInFlight = true;
    try {
      let hasMore = true;
      while (hasMore) {
        const res = await api.backfillSince(lastSeenAt);
        if (res.messages.length > 0) {
          ui.addMessages(res.messages);
          recordMessages(res.messages);
          for (const m of res.messages) {
            if (m.role === 'agent') {
              agentTurnsThisSession += 1;
              ui.setAgentTyping(false);
            }
          }
          const last = res.messages[res.messages.length - 1]!;
          lastSeenAt = new Date(last.at);
        }
        if (res.conversation) {
          ui.setConversation(res.conversation);
          currentEnvelope = res.conversation;
          ui.setVoiceCallWho(callWhoFromEnvelope(res.conversation));
          if (res.conversation.contactEmail) visitorHasEmail = true;
          if (currentConversationId !== res.conversation.id) {
            currentConversationId = res.conversation.id;
            void probeVoiceAvailability(res.conversation.id);
          }
        }
        hasMore = res.hasMore;
      }
      maybeShowEmailCard();
    } catch (err) {
      if (err instanceof WidgetApiError) {
        console.warn(`[munin-widget] backfill failed: ${err.status}`);
      } else {
        console.warn('[munin-widget] backfill failed:', err);
      }
    } finally {
      backfillInFlight = false;
      if (backfillPending) {
        backfillPending = false;
        void backfill();
      }
    }
  }

  async function refreshPastConversations(): Promise<void> {
    if (!config.showHistory) return;
    try {
      const recent = getRecentSessionIds(config.channelId);
      const convs = await api.listConversations(recent);
      ui.setPastConversations(convs);
    } catch (err) {
      if (err instanceof WidgetApiError && err.status === 404) return;
      console.warn('[munin-widget] list conversations failed:', err);
    }
  }

  function maybeShowEmailCard(): void {
    if (emailCardShown || visitorHasEmail) return;
    if (agentTurnsThisSession < 1) return;
    emailCardShown = true;
    ui.showEmailCard();
  }

  function switchToSession(next: string): void {
    sessionId = next;
    api.setSessionId(next);
    realtime.setSessionId(next);
    lastSeenAt = undefined;
    agentTurnsThisSession = 0;
    emailCardShown = false;
    currentConversationId = null;
    currentEnvelope = null;
    voiceProbedFor = null;
    if (voiceSession) {
      void endVoice();
    }
    ui.setVoiceAvailable(false);
    ui.setVoiceState('idle');
    ui.resetChat();
    ui.setView('chat');
    if (realtime.state() === 'connected') {
      void backfill();
    }
  }

  function startConversation(): void {
    ui.setChatKind('new');
    switchToSession(mintNewSession(config.channelId));
    api.startConversation().catch((err) => {
      if (err instanceof WidgetApiError) {
        console.warn(`[munin-widget] start conversation failed: ${err.status}`);
      } else {
        console.warn('[munin-widget] start conversation failed:', err);
      }
    });
  }

  function openConversation(summary: ConversationSummary): void {
    ui.setChatKind('existing');
    if (summary.sessionId === sessionId) {
      ui.setView('chat');
      return;
    }
    setCurrentSession(config.channelId, summary.sessionId);
    switchToSession(summary.sessionId);
  }

  async function setVisitorEmail(email: string): Promise<void> {
    try {
      await api.setVisitorEmail(email);
      visitorHasEmail = true;
      ui.setEmailSaved(email);
    } catch (err) {
      if (err instanceof WidgetApiError) {
        console.warn(`[munin-widget] set email failed: ${err.status}`);
      } else {
        console.warn('[munin-widget] set email failed:', err);
      }
    }
  }

  let currentConversationId: string | null = null;
  let currentEnvelope: ConversationEnvelope | null = null;
  let voiceSession: VoiceSession | null = null;
  let voiceProbedFor: string | null = null;
  let voiceCallStartedAt: number | null = null;
  let voiceStartedEmitted = false;

  function callWhoFromEnvelope(env: ConversationEnvelope | null): string {
    if (env?.handedOver) {
      return env.assigneeName ?? strings.defaultTeammateName;
    }
    return strings.defaultAuthorName;
  }

  async function probeVoiceAvailability(conversationId: string): Promise<void> {
    if (voiceProbedFor === conversationId) return;
    voiceProbedFor = conversationId;
    try {
      const res = await api.voiceStart(conversationId);
      ui.setVoiceAvailable(res.available);
    } catch (err) {
      if (err instanceof WidgetApiError) {
        console.warn(`[munin-widget] voice probe failed: ${err.status}`);
      } else {
        console.warn('[munin-widget] voice probe failed:', err);
      }
      ui.setVoiceAvailable(false);
    }
  }

  function emitVoiceStarted(): void {
    if (voiceStartedEmitted) return;
    if (!currentConversationId) return;
    voiceStartedEmitted = true;
    voiceCallStartedAt = Date.now();
    api
      .voiceEvent({ conversationId: currentConversationId, kind: 'started' })
      .catch((err) => console.warn('[munin-widget] voice event (started) failed:', err));
  }

  function emitVoiceEnded(): void {
    if (!voiceStartedEmitted) return;
    if (!currentConversationId) {
      voiceStartedEmitted = false;
      voiceCallStartedAt = null;
      return;
    }
    const durationSeconds =
      voiceCallStartedAt !== null
        ? Math.max(0, Math.floor((Date.now() - voiceCallStartedAt) / 1000))
        : 0;
    const convId = currentConversationId;
    voiceStartedEmitted = false;
    voiceCallStartedAt = null;
    api
      .voiceEvent({ conversationId: convId, kind: 'ended', durationSeconds })
      .catch((err) => console.warn('[munin-widget] voice event (ended) failed:', err));
  }

  async function startVoice(): Promise<void> {
    if (voiceSession) return;
    if (!currentConversationId) {
      console.warn('[munin-widget] voice start: no active conversation');
      return;
    }
    ui.setVoiceCallWho(callWhoFromEnvelope(currentEnvelope));
    ui.setVoiceState('connecting');
    let res;
    try {
      res = await api.voiceStart(currentConversationId);
    } catch (err) {
      ui.setVoiceState('error');
      console.warn('[munin-widget] voice start request failed:', err);
      return;
    }
    if (!res.available) {
      ui.setVoiceState('error');
      ui.setVoiceAvailable(false);
      console.warn(`[munin-widget] voice unavailable: ${res.reason}`);
      return;
    }
    const session = createVoiceSession(res.descriptor);
    voiceSession = session;
    voiceStartedEmitted = false;
    voiceCallStartedAt = null;
    session.subscribe((event) => {
      if (event.type === 'state') {
        ui.setVoiceState(event.state);
        if (event.state === 'listening' || event.state === 'speaking') {
          emitVoiceStarted();
        }
        if (event.state === 'ended' || event.state === 'error') {
          emitVoiceEnded();
          voiceSession = null;
        }
      } else if (event.type === 'error') {
        console.warn('[munin-widget] voice error:', event.error);
      }
    });
    try {
      await session.start();
    } catch (err) {
      console.warn('[munin-widget] voice session start failed:', err);
      voiceSession = null;
    }
  }

  async function endVoice(): Promise<void> {
    if (!voiceSession) return;
    try {
      await voiceSession.end();
    } finally {
      voiceSession = null;
      ui.setVoiceState('ended');
      emitVoiceEnded();
    }
  }

  function toggleVoiceMute(muted: boolean): void {
    voiceSession?.setMuted(muted);
  }

  const { strings } = pickLocale(config.locale);
  const ui: UiController = mount(config, strings, {
    onSend(text) {
      void sendMessage(text);
    },
    onTypingIntent(intent) {
      realtime.sendTyping(intent === 'typing');
    },
    onStartConversation() {
      startConversation();
    },
    onOpenConversation(summary) {
      openConversation(summary);
    },
    onBackToWelcome() {
      void refreshPastConversations();
    },
    onSetVisitorEmail(email) {
      void setVisitorEmail(email);
    },
    onMessageRead(messageId) {
      realtime.sendRead([messageId]);
      markLocallyRead(messageId);
    },
    onVoiceStart() {
      void startVoice();
    },
    onVoiceEnd() {
      void endVoice();
    },
    onVoiceMuteToggle(muted) {
      toggleVoiceMute(muted);
    },
  });

  async function sendMessage(text: string): Promise<void> {
    ui.setSending(true);
    try {
      await api.postMessage(text);
    } catch (err) {
      if (err instanceof WidgetApiError) {
        console.warn(`[munin-widget] send failed: ${err.status}`);
      } else {
        console.warn('[munin-widget] send failed:', err);
      }
    } finally {
      ui.setSending(false);
    }
  }

  realtime.onState((state) => {
    ui.setConnectionState(state);
    if (state === 'connected') {
      void backfill();
      void refreshPastConversations();
    }
  });

  realtime.onEvent(() => {
    void backfill();
  });

  realtime.onTyping((msg: IncomingTyping) => {
    if (msg.authorType === 'operator') {
      ui.setAgentTyping(msg.isTyping);
    }
  });

  realtime.connect();

  window.addEventListener(
    'beforeunload',
    () => {
      realtime.close();
      ui.destroy();
    },
    { once: true },
  );
}

function currentScript(): HTMLElement | null {
  const cur = document.currentScript;
  if (cur instanceof HTMLElement) return cur;
  const all = document.querySelectorAll('script[data-widget-key]');
  return (all[all.length - 1] as HTMLElement | undefined) ?? null;
}

bootstrap();
