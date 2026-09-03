import type { ApiIdentity } from './api.ts';

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
  webSocketCtor?: WebSocketConstructor;
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
const IDENTITY_FALLBACK_AFTER_FAILURES = 3;

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
  let identitySuppressed = false;
  let identityFailures = 0;
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

  function buildUrl(): { url: string; withIdentity: boolean } {
    const base = httpToWs(deps.host) + '/v1/realtime';
    const identity = identitySuppressed ? undefined : deps.getIdentity?.();
    if (!identity) return { url: base, withIdentity: false };
    const u = new URL(base);
    u.searchParams.set('externalId', identity.externalId);
    u.searchParams.set('userHash', identity.userHash);
    return { url: u.toString(), withIdentity: true };
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
    const target = buildUrl();
    let socket: WebSocketLike;
    try {
      socket = new WS(target.url, ['bearer', deps.widgetKey]);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
      identityFailures = 0;
      attempt = 0;
      setState('connected');
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
    });
    socket.addEventListener('close', () => {
      ws = null;
      if (!opened) {
        if (target.withIdentity) {
          identityFailures += 1;
          if (identityFailures >= IDENTITY_FALLBACK_AFTER_FAILURES) {
            identityFailures = 0;
            identitySuppressed = true;
            attempt = 0;
            console.warn(
              '[munin-widget] realtime identity was rejected; reconnecting without it. Check that the widget channel secret used to sign userHash matches this channelId.',
            );
          }
        } else if (identitySuppressed) {
          identitySuppressed = false;
        }
      }
      if (closedByCaller) {
        setState('closed');
      } else {
        scheduleReconnect();
      }
    });
    socket.addEventListener('error', () => {
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
      identitySuppressed = false;
      identityFailures = 0;
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
