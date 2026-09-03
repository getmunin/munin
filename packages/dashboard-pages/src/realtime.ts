'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getActiveOrgId } from './auth/active-org';

export interface RealtimeEventRow {
  id: string;
  org_id: string;
  type: string;
  actor_id: string | null;
  correlation_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export type SubscriptionChannel =
  | { channel: 'org' }
  | { channel: 'conversation'; id: string }
  | { channel: 'contact'; id: string };

interface IncomingFrame {
  type: 'event' | 'ready' | 'pong' | 'typing';
  channel?: string;
  event?: RealtimeEventRow;
  orgId?: string;
  isTyping?: boolean;
  authorType?: 'visitor' | 'operator';
}

export interface TypingSignal {
  conversationId: string;
  authorType: 'visitor' | 'operator';
  isTyping: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const TYPING_STALE_MS = 10_000;
const TYPING_LINGER_MS = 5_000;
const TEARDOWN_GRACE_MS = 300;
const TYPING_SEND_THROTTLE_MS = 2_000;

export type RealtimeStatus = 'connecting' | 'connected' | 'offline';

function subKey(sub: SubscriptionChannel): string {
  return 'id' in sub ? `${sub.channel}:${sub.id}` : sub.channel;
}

interface Listener {
  channels: Set<string>;
  onEvent: (event: RealtimeEventRow) => void;
}

interface TypingListener {
  channels: Set<string>;
  onTyping: (signal: TypingSignal) => void;
}

class RealtimeClient {
  private ws: WebSocket | null = null;
  private status: RealtimeStatus = 'connecting';
  private readonly listeners = new Set<Listener>();
  private readonly typingListeners = new Set<TypingListener>();
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  private readonly refcounts = new Map<string, number>();
  private readonly activeSubs = new Set<string>();
  private backoffMs = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;

  getStatus(): RealtimeStatus {
    return this.status;
  }

  subscribeStatus(cb: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  addListener(listener: Listener): void {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    this.listeners.add(listener);
    for (const key of listener.channels) this.retain(key);
    this.ensureConnection();
  }

  removeListener(listener: Listener): void {
    if (!this.listeners.delete(listener)) return;
    for (const key of listener.channels) this.release(key);
    if (this.listeners.size > 0 || this.teardownTimer) return;
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;
      if (this.listeners.size === 0) this.teardown();
    }, TEARDOWN_GRACE_MS);
  }

  setListenerChannels(listener: Listener, subscriptions: readonly SubscriptionChannel[]): void {
    const next = new Set(subscriptions.map(subKey));
    for (const key of listener.channels) {
      if (!next.has(key)) this.release(key);
    }
    for (const key of next) {
      if (!listener.channels.has(key)) this.retain(key);
    }
    listener.channels = next;
  }

  private retain(key: string): void {
    const count = (this.refcounts.get(key) ?? 0) + 1;
    this.refcounts.set(key, count);
    if (count === 1) this.send({ type: 'subscribe', ...decodeKey(key) }, key, true);
  }

  private release(key: string): void {
    const count = (this.refcounts.get(key) ?? 0) - 1;
    if (count <= 0) {
      this.refcounts.delete(key);
      this.send({ type: 'unsubscribe', ...decodeKey(key) }, key, false);
    } else {
      this.refcounts.set(key, count);
    }
  }

  private send(payload: object, key: string, active: boolean): void {
    const ws = this.ws;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
      if (active) this.activeSubs.add(key);
      else this.activeSubs.delete(key);
    }
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusListeners) cb(status);
  }

  private ensureConnection(): void {
    if (this.ws || typeof WebSocket === 'undefined') return;
    this.connect();
  }

  private connect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus('connecting');
    const orgId = getActiveOrgId();
    const url =
      API_URL.replace(/^http/, 'ws') +
      '/v1/realtime' +
      (orgId ? `?orgId=${encodeURIComponent(orgId)}` : '');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoffMs = 500;
      this.setStatus('connected');
      this.activeSubs.clear();
      for (const key of this.refcounts.keys()) {
        ws.send(JSON.stringify({ type: 'subscribe', ...decodeKey(key) }));
        this.activeSubs.add(key);
      }
      this.pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30_000);
    };

    ws.onmessage = (msg) => {
      let frame: IncomingFrame | null = null;
      try {
        frame = JSON.parse(msg.data as string) as IncomingFrame;
      } catch (err) {
        console.debug('[munin/realtime] dropped malformed frame', err);
        return;
      }
      if (frame.type === 'event' && frame.event) this.dispatch(frame.channel, frame.event);
      if (frame.type === 'typing' && frame.channel) {
        console.debug('[munin/realtime] typing frame', frame);
        this.dispatchTyping(frame.channel, {
          conversationId: frame.channel.replace(/^conversation:/, ''),
          authorType: frame.authorType ?? 'visitor',
          isTyping: frame.isTyping === true,
        });
      }
    };

    ws.onerror = () => undefined;

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.ws = null;
      this.activeSubs.clear();
      if (this.listeners.size === 0) return;
      this.setStatus('offline');
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private dispatchTyping(channel: string, signal: TypingSignal): void {
    let matched = 0;
    for (const listener of this.typingListeners) {
      if (!listener.channels.has(channel)) continue;
      matched += 1;
      try {
        listener.onTyping(signal);
      } catch (err) {
        console.debug('[munin/realtime] typing listener threw', err);
      }
    }
    console.debug(
      '[munin/realtime] typing dispatch channel=%s matched=%s/%s',
      channel,
      matched,
      this.typingListeners.size,
      matched === 0
        ? [...this.typingListeners].map((l) => [...l.channels].join(','))
        : undefined,
    );
  }

  addTypingListener(listener: TypingListener): () => void {
    this.typingListeners.add(listener);
    return () => this.typingListeners.delete(listener);
  }

  sendTyping(conversationId: string, isTyping: boolean): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({ type: 'typing', channel: 'conversation', id: conversationId, isTyping }),
    );
  }

  private dispatch(channel: string | undefined, event: RealtimeEventRow): void {
    for (const listener of this.listeners) {
      if (channel === undefined || listener.channels.has(channel)) listener.onEvent(event);
    }
  }

  private clearTimers(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardown(): void {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    this.clearTimers();
    this.activeSubs.clear();
    this.refcounts.clear();
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch (err) {
      console.warn('[munin/realtime] ws.close() failed during teardown', err);
    }
  }
}

function decodeKey(key: string): SubscriptionChannel {
  const sep = key.indexOf(':');
  if (sep < 0) return { channel: 'org' };
  const channel = key.slice(0, sep) as 'conversation' | 'contact';
  return { channel, id: key.slice(sep + 1) };
}

const client = new RealtimeClient();

export function useRealtime(
  subscriptions: readonly SubscriptionChannel[],
  onEvent: (event: RealtimeEventRow) => void,
): { connected: boolean; status: RealtimeStatus } {
  const [status, setStatus] = useState<RealtimeStatus>(() => client.getStatus());
  const connected = status === 'connected';

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const subsRef = useRef<readonly SubscriptionChannel[]>(subscriptions);
  subsRef.current = subscriptions;

  const listenerRef = useRef<Listener | null>(null);

  useEffect(() => {
    const listener: Listener = {
      channels: new Set(subsRef.current.map(subKey)),
      onEvent: (event) => onEventRef.current(event),
    };
    listenerRef.current = listener;
    const unsubscribeStatus = client.subscribeStatus(setStatus);
    setStatus(client.getStatus());
    client.addListener(listener);
    return () => {
      client.removeListener(listener);
      listenerRef.current = null;
      unsubscribeStatus();
    };
  }, []);

  const subsKey = subscriptions.map(subKey).sort().join(',');
  useEffect(() => {
    const listener = listenerRef.current;
    if (listener) client.setListenerChannels(listener, subsRef.current);
  }, [subsKey]);

  return { connected, status };
}

export function useConversationTyping(conversationId: string | null): {
  visitorTyping: boolean;
  notifyTyping: (isTyping: boolean) => void;
  clearVisitorTyping: () => void;
} {
  const [visitorTyping, setVisitorTyping] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentAt = useRef(0);

  useEffect(() => {
    setVisitorTyping(false);
    if (!conversationId) return;
    const listener = {
      channels: new Set([`conversation:${conversationId}`]),
      onTyping: (signal: TypingSignal) => {
        if (signal.authorType !== 'visitor') return;
        if (clearTimer.current) clearTimeout(clearTimer.current);
        if (signal.isTyping) {
          setVisitorTyping(true);
          clearTimer.current = setTimeout(() => setVisitorTyping(false), TYPING_STALE_MS);
        } else {
          clearTimer.current = setTimeout(() => setVisitorTyping(false), TYPING_LINGER_MS);
        }
      },
    };
    console.debug(`[munin/realtime] typing listener armed for conversation:${conversationId}`);
    const remove = client.addTypingListener(listener);
    return () => {
      remove();
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [conversationId]);

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!conversationId) return;
      const now = Date.now();
      if (isTyping && now - lastSentAt.current < TYPING_SEND_THROTTLE_MS) return;
      lastSentAt.current = isTyping ? now : 0;
      console.debug(`[munin/realtime] sending operator typing=${isTyping} conv=${conversationId}`);
      client.sendTyping(conversationId, isTyping);
    },
    [conversationId],
  );

  const clearVisitorTyping = useCallback(() => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setVisitorTyping(false);
  }, []);

  return { visitorTyping, notifyTyping, clearVisitorTyping };
}
