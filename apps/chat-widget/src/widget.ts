import { parseConfig, type WidgetConfig } from './config.js';
import {
  getRecentSessionIds,
  getSessionId,
  getVisitorId,
  mintNewSession,
  setCurrentSession,
} from './session.js';
import { createApiClient, WidgetApiError, type ConversationSummary } from './api.js';
import { createRealtimeClient, type IncomingTyping } from './realtime.js';
import { mount, type UiController } from './ui.js';

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
          if (res.conversation.contactEmail) visitorHasEmail = true;
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
      const filtered = convs.filter((c) => c.sessionId !== sessionId);
      ui.setPastConversations(filtered);
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

  const ui: UiController = mount(config, {
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
