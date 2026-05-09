import { parseConfig, type WidgetConfig } from './config.js';
import { getSessionId } from './session.js';
import { createApiClient, WidgetApiError, type ListedMessage } from './api.js';
import { createRealtimeClient, type IncomingTyping } from './realtime.js';
import { mount, type UiController } from './ui.js';

/**
 * Bootstrap entry. Wires the full pipeline:
 *
 *   parseConfig → getSessionId → createApiClient → createRealtimeClient
 *                                                       │
 *                  mount(UI) ◄────────────────────────── │
 *                       │                                │
 *                       ├── onSend ─► api.postMessage    │
 *                       └── onTypingIntent ─► realtime.sendTyping
 *                                                        │
 *   realtime.onState('connected') ─► api.backfillSince(lastSeenAt)
 *                                       └─► ui.addMessages
 *   realtime.onEvent (any) ─► api.backfillSince(lastSeenAt)
 *                                       └─► ui.addMessages
 *   realtime.onTyping(operator) ─► ui.setAgentTyping
 *
 * Important: there is no recurring timer pulling messages. WS events
 * trigger one-shot REST backfills; reconnect triggers one. That's it.
 */
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
  const sessionId = getSessionId(config.channelId);
  const identity =
    config.externalId && config.userHash
      ? { externalId: config.externalId, userHash: config.userHash }
      : undefined;
  const api = createApiClient({
    host: config.host,
    widgetKey: config.widgetKey,
    channelId: config.channelId,
    sessionId,
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

  /**
   * Fetch any messages newer than `lastSeenAt`, append them, advance the
   * cursor. Coalesces concurrent calls: if a backfill is already in
   * flight when we're called, we set a flag and the in-flight call
   * recurses once it completes. This keeps the widget at most one round-
   * trip behind even if events arrive in bursts.
   */
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
          const last = res.messages[res.messages.length - 1]!;
          lastSeenAt = new Date(last.at);
        }
        hasMore = res.hasMore;
      }
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

  let ui: UiController;

  ui = mount(config, {
    async onSend(text) {
      ui.setSending(true);
      try {
        await api.postMessage(text);
        // Don't optimistically render — the WS event triggers a backfill
        // that will pull the canonical message in.
      } catch (err) {
        if (err instanceof WidgetApiError) {
          console.warn(`[munin-widget] send failed: ${err.status}`);
        } else {
          console.warn('[munin-widget] send failed:', err);
        }
      } finally {
        ui.setSending(false);
      }
    },
    onTypingIntent(intent) {
      realtime.sendTyping(intent === 'typing');
    },
  });

  realtime.onState((state) => {
    ui.setConnectionState(state);
    if (state === 'connected') void backfill();
  });

  realtime.onEvent(() => {
    // Any event arrives ⇒ pull the new messages. The event payload only
    // has conversationId + messageId; the canonical body comes from
    // backfillSince which uses the same auth + scope.
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
