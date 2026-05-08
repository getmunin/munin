'use client';

import { useEffect, useRef, useState } from 'react';

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
  type: 'event' | 'ready' | 'pong';
  channel?: string;
  event?: RealtimeEventRow;
  orgId?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Single WebSocket per hook instance. Each hook re-subscribes on mount
 * and closes on unmount. Auto-reconnects with capped exponential backoff
 * while the component is mounted. Fires `onEvent` for every matching
 * incoming event; the caller decides what to do with it.
 */
export function useRealtime(
  subscriptions: readonly SubscriptionChannel[],
  onEvent: (event: RealtimeEventRow) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const subsRef = useRef<readonly SubscriptionChannel[]>(subscriptions);
  subsRef.current = subscriptions;
  const subsKey = subscriptions
    .map((s) => ('id' in s ? `${s.channel}:${s.id}` : s.channel))
    .sort()
    .join(',');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let backoffMs = 500;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    const url = API_URL.replace(/^http/, 'ws') + '/api/v1/realtime';

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        if (cancelled || !ws) return;
        backoffMs = 500;
        setConnected(true);
        for (const sub of subsRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe', ...sub }));
        }
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30_000);
      };
      ws.onmessage = (msg) => {
        let frame: IncomingFrame | null = null;
        try {
          frame = JSON.parse(msg.data as string) as IncomingFrame;
        } catch {
          return;
        }
        if (frame.type === 'event' && frame.event) {
          onEventRef.current(frame.event);
        }
      };
      ws.onerror = () => undefined;
      ws.onclose = () => {
        setConnected(false);
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = null;
        if (cancelled) return;
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, 30_000);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      setConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          return;
        }
      }
    };
  }, [subsKey]);

  return { connected };
}
