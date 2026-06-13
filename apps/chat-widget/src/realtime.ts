import type { ApiIdentity } from './api.ts';

/**
 * WebSocket client for the widget.
 *
 * Lifecycle: `connect()` opens a WebSocket to /v1/realtime, sends a
 * `subscribe` for `widget:<channelId>:<sessionId>`, and emits the
 * `connected` state. Consumers run their one-shot REST backfill in
 * response — the realtime client itself never polls REST.
 *
 * Reconnect: on close (and the network errors that lead there) the
 * client schedules another connect with exponential backoff
 * (250 ms → 30 s, jittered). It re-emits `connected` on each successful
 * (re)open so consumers can re-run the backfill bringing it back in
 * sync with anything they missed during the disconnect.
 *
 * Typing: visitor calls `sendTyping(true)` / `sendTyping(false)`. The
 * client throttles outbound `typing:true` to one frame per 1.5 s
 * (matches the server's throttle so we don't waste frames). Inbound
 * `typing` events from operators surface via `onTyping`.
 */

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface IncomingEvent {
  type: 'event';
  channel: string;
  event: { type: string; payload?: Record<string, unknown> };
}

export interface IncomingTyping {
  type: 'typing';
  channel: string;
  isTyping: boolean;
  authorType: 'visitor' | 'operator';
}

export type EventListener = (msg: IncomingEvent) => void;
export type TypingListener = (msg: IncomingTyping) => void;
export type StateListener = (state: ConnectionState) => void;

export interface RealtimeClientDeps {
  host: string;
  widgetKey: string;
  channelId: string;
  sessionId: string;
  getIdentity?: () => ApiIdentity | undefined;
  /** Override the WebSocket constructor for tests. */
  webSocketCtor?: WebSocketConstructor;
  /** Override the schedule API for tests. */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

interface WebSocketConstructor {
  new (url: string, protocols?: string | string[]): WebSocketLike;
  readonly OPEN: number;
  readonly CLOSED: number;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Native browser WebSocket dispatches `Event`, `MessageEvent`, etc.
   *  We only read `event.data` for messages; everything else is fire-only.
   *  Listener parameter is `unknown` so a single permissive implementation
   *  satisfies all event types. */
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (arg?: unknown) => void): void;
}

export interface RealtimeClient {
  connect(): void;
  close(): void;
  reconnect(): void;
  state(): ConnectionState;
  sendTyping(isTyping: boolean): void;
  sendRead(messageIds: string[]): void;
  setSessionId(sessionId: string): void;
  onEvent(l: EventListener): () => void;
  onTyping(l: TypingListener): () => void;
  onState(l: StateListener): () => void;
}

const TYPING_MIN_INTERVAL_MS = 1500;
const READ_FLUSH_MS = 200;
const RECONNECT_INITIAL_MS = 250;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_JITTER_MS = 250;

export function createRealtimeClient(deps: RealtimeClientDeps): RealtimeClient {
  const setTimeoutFn = deps.setTimeoutImpl ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutImpl ?? clearTimeout;
  const WS = deps.webSocketCtor ?? (globalThis.WebSocket);

  let ws: WebSocketLike | null = null;
  let currentState: ConnectionState = 'idle';
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTypingSentAt = 0;
  let closedByCaller = false;
  let sessionId = deps.sessionId;
  const pendingReadIds = new Set<string>();
  let readFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushReads(): void {
    readFlushTimer = null;
    if (pendingReadIds.size === 0) return;
    if (!ws || ws.readyState !== WS.OPEN) return;
    const messageIds = Array.from(pendingReadIds);
    pendingReadIds.clear();
    try {
      ws.send(
        JSON.stringify({
          type: 'read',
          channel: 'widget',
          channelId: deps.channelId,
          sessionId,
          messageIds,
        }),
      );
    } catch {
      // socket mid-close; re-queue so the next flush retries
      for (const id of messageIds) pendingReadIds.add(id);
    }
  }

  const eventListeners = new Set<EventListener>();
  const typingListeners = new Set<TypingListener>();
  const stateListeners = new Set<StateListener>();

  function setState(next: ConnectionState): void {
    if (next === currentState) return;
    currentState = next;
    for (const l of stateListeners) {
      try {
        l(next);
      } catch (err) {
        console.debug('[munin-widget] state listener threw:', err);
      }
    }
  }

  function buildUrl(): string {
    const base = httpToWs(deps.host) + '/v1/realtime';
    const identity = deps.getIdentity?.();
    if (!identity) return base;
    const u = new URL(base);
    u.searchParams.set('externalId', identity.externalId);
    u.searchParams.set('userHash', identity.userHash);
    return u.toString();
  }

  function scheduleReconnect(): void {
    if (closedByCaller) return;
    setState('reconnecting');
    const backoff = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_INITIAL_MS * 2 ** Math.min(attempt, 7),
    );
    const jitter = Math.floor(Math.random() * RECONNECT_MAX_JITTER_MS);
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      doConnect();
    }, backoff + jitter);
    attempt += 1;
  }

  function doConnect(): void {
    if (closedByCaller) return;
    if (ws && ws.readyState !== WS.CLOSED) return;
    setState('connecting');
    let socket: WebSocketLike;
    try {
      socket = new WS(buildUrl(), ['bearer', deps.widgetKey]);
    } catch {
      // Construction can throw on some browsers if the URL is bad.
      scheduleReconnect();
      return;
    }
    ws = socket;
    socket.addEventListener('open', () => {
      attempt = 0;
      setState('connected');
      // Subscribe to our (channelId, sessionId) tuple so the gateway
      // routes operator-side events back to us.
      try {
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            channel: 'widget',
            channelId: deps.channelId,
            sessionId,
          }),
        );
      } catch (err) {
        console.warn('[munin-widget] subscribe send failed:', err);
      }
    });
    socket.addEventListener('message', (event) => {
      const data = (event as { data?: unknown } | undefined)?.data;
      let msg: { type?: string } | null = null;
      try {
        msg = JSON.parse(String(data)) as { type?: string };
      } catch {
        return;
      }
      if (msg.type === 'event') {
        for (const l of eventListeners) {
          try {
            l(msg as IncomingEvent);
          } catch (err) {
            console.debug('[munin-widget] event listener threw:', err);
          }
        }
      } else if (msg.type === 'typing') {
        for (const l of typingListeners) {
          try {
            l(msg as IncomingTyping);
          } catch (err) {
            console.debug('[munin-widget] typing listener threw:', err);
          }
        }
      }
      // ready / pong / unknown: ignore
    });
    socket.addEventListener('close', () => {
      ws = null;
      if (closedByCaller) {
        setState('closed');
      } else {
        scheduleReconnect();
      }
    });
    socket.addEventListener('error', () => {
      // The browser fires `error` then `close`; the close handler
      // schedules the reconnect. No-op here so we don't double-schedule.
    });
  }

  return {
    connect() {
      closedByCaller = false;
      doConnect();
    },
    close() {
      closedByCaller = true;
      if (reconnectTimer) {
        clearTimeoutFn(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws && ws.readyState !== WS.CLOSED) {
        try {
          ws.close();
        } catch (err) {
          console.warn('[munin-widget] socket close failed:', err);
        }
      }
      setState('closed');
    },
    reconnect() {
      closedByCaller = false;
      attempt = 0;
      if (reconnectTimer) {
        clearTimeoutFn(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws && ws.readyState !== WS.CLOSED) {
        try {
          ws.close();
        } catch (err) {
          console.warn('[munin-widget] socket close failed during reconnect:', err);
        }
        ws = null;
      }
      doConnect();
    },
    state() {
      return currentState;
    },
    sendTyping(isTyping) {
      if (!ws || ws.readyState !== WS.OPEN) return;
      if (isTyping) {
        const now = Date.now();
        if (now - lastTypingSentAt < TYPING_MIN_INTERVAL_MS) return;
        lastTypingSentAt = now;
      } else {
        // Allow explicit retract regardless of throttle so the operator's
        // bubble clears immediately.
        lastTypingSentAt = 0;
      }
      try {
        ws.send(
          JSON.stringify({
            type: 'typing',
            channel: 'widget',
            channelId: deps.channelId,
            sessionId,
            isTyping,
          }),
        );
      } catch (err) {
        console.warn('[munin-widget] typing send failed:', err);
      }
    },
    sendRead(messageIds) {
      for (const id of messageIds) {
        if (typeof id === 'string' && id.length > 0) pendingReadIds.add(id);
      }
      if (pendingReadIds.size === 0) return;
      if (readFlushTimer) return;
      readFlushTimer = setTimeoutFn(flushReads, READ_FLUSH_MS);
    },
    onEvent(l) {
      eventListeners.add(l);
      return () => eventListeners.delete(l);
    },
    onTyping(l) {
      typingListeners.add(l);
      return () => typingListeners.delete(l);
    },
    onState(l) {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    setSessionId(next) {
      if (next === sessionId) return;
      sessionId = next;
      if (ws && ws.readyState === WS.OPEN) {
        try {
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              channel: 'widget',
              channelId: deps.channelId,
              sessionId,
            }),
          );
        } catch (err) {
          console.warn('[munin-widget] resubscribe failed:', err);
        }
      }
    },
  };
}

function httpToWs(host: string): string {
  if (host.startsWith('https://')) return 'wss://' + host.slice('https://'.length);
  if (host.startsWith('http://')) return 'ws://' + host.slice('http://'.length);
  return host;
}
