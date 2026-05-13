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

export type RealtimeStatus = 'connecting' | 'connected' | 'offline';

function subKey(sub: SubscriptionChannel): string {
  return 'id' in sub ? `${sub.channel}:${sub.id}` : sub.channel;
}

export function useRealtime(
  subscriptions: readonly SubscriptionChannel[],
  onEvent: (event: RealtimeEventRow) => void,
): { connected: boolean; status: RealtimeStatus } {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const connected = status === 'connected';
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const wsRef = useRef<WebSocket | null>(null);
  const activeSubsRef = useRef<Map<string, SubscriptionChannel>>(new Map());

  const subsKey = subscriptions.map(subKey).sort().join(',');
  const desiredSubsRef = useRef<readonly SubscriptionChannel[]>(subscriptions);
  desiredSubsRef.current = subscriptions;

  useEffect(() => {
    let backoffMs = 500;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    const url = API_URL.replace(/^http/, 'ws') + '/api/v1/realtime';

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        if (cancelled || wsRef.current !== ws) return;
        backoffMs = 500;
        setStatus('connected');
        activeSubsRef.current = new Map();
        for (const sub of desiredSubsRef.current) {
          const key = subKey(sub);
          ws.send(JSON.stringify({ type: 'subscribe', ...sub }));
          activeSubsRef.current.set(key, sub);
        }
        pingInterval = setInterval(() => {
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
        if (frame.type === 'event' && frame.event) {
          onEventRef.current(frame.event);
        }
      };
      ws.onerror = () => undefined;
      ws.onclose = () => {
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = null;
        if (cancelled) return;
        wsRef.current = null;
        activeSubsRef.current = new Map();
        setStatus('offline');
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, 30_000);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
      const ws = wsRef.current;
      wsRef.current = null;
      activeSubsRef.current = new Map();
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch (err) {
          console.warn('[munin/realtime] ws.close() failed during cleanup', err);
          return;
        }
      }
    };
  }, []);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    const desired = new Map<string, SubscriptionChannel>();
    for (const sub of desiredSubsRef.current) desired.set(subKey(sub), sub);
    const active = activeSubsRef.current;
    for (const [key, sub] of active) {
      if (!desired.has(key)) {
        ws.send(JSON.stringify({ type: 'unsubscribe', ...sub }));
        active.delete(key);
      }
    }
    for (const [key, sub] of desired) {
      if (!active.has(key)) {
        ws.send(JSON.stringify({ type: 'subscribe', ...sub }));
        active.set(key, sub);
      }
    }
  }, [subsKey]);

  return { connected, status };
}
