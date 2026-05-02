'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input } from '@getmunin/ui';
import { api, ApiError } from '../api';
import { useRealtime, type SubscriptionChannel } from '../realtime';

const POLL_MS = 30_000;

interface ActivityDto {
  id: string;
  type: string;
  actorId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface ActivityPageResponse {
  items: ActivityDto[];
  nextCursor: string | null;
}

export function ActivityPage() {
  const [items, setItems] = useState<ActivityDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [filterTypes, setFilterTypes] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const buildParams = useCallback(
    (cursorParam: string | null) => {
      const params = new URLSearchParams();
      if (filterTypes.trim()) params.set('types', filterTypes.trim());
      if (filterActor.trim()) params.set('actorId', filterActor.trim());
      if (cursorParam) params.set('cursor', cursorParam);
      params.set('limit', '50');
      return params;
    },
    [filterTypes, filterActor],
  );

  const refresh = useCallback(async () => {
    try {
      const params = buildParams(null);
      const page = await api<ActivityPageResponse>(`/api/activity?${params.toString()}`);
      setItems(page.items);
      setCursor(page.nextCursor);
      setExhausted(page.nextCursor === null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load activity');
    }
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const params = buildParams(cursor);
      const page = await api<ActivityPageResponse>(`/api/activity?${params.toString()}`);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setExhausted(page.nextCursor === null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load more');
    }
  }, [buildParams, cursor]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => [{ channel: 'org' }], []);
  useRealtime(subscriptions, () => {
    void refresh();
  });

  return (
    <>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Activity className="size-5" />
          Activity
        </h1>
        <p className="text-sm text-muted-foreground">
          Org-wide event stream — every conversation message, status change, handover, KB write,
          and CRM update as it happens.
        </p>
      </header>

      <Card>
        <CardContent className="grid gap-3 py-3 md:grid-cols-3">
          <Input
            placeholder="event types (comma-separated)"
            value={filterTypes}
            onChange={(e) => setFilterTypes(e.target.value)}
          />
          <Input
            placeholder="actorId"
            value={filterActor}
            onChange={(e) => setFilterActor(e.target.value)}
          />
          <Button
            onClick={() => {
              setCursor(null);
              setExhausted(false);
              void refresh();
            }}
          >
            Apply
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-lg border bg-background">
        <ul className="divide-y">
          {items.map((e) => (
            <li key={e.id} className="grid grid-cols-[10rem_minmax(0,12rem)_1fr] gap-3 px-3 py-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{relative(e.createdAt)}</span>
              <span className="truncate">
                <Badge variant={badgeVariantFor(e.type)}>{e.type}</Badge>
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {summary(e)}
              </span>
            </li>
          ))}
          {items.length === 0 && !error && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No events yet.
            </li>
          )}
        </ul>
      </div>

      {!exhausted && items.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function badgeVariantFor(type: string): 'warning' | 'success' | 'secondary' | 'default' {
  if (type.includes('handover')) return 'warning';
  if (type.includes('taken_over') || type.includes('released')) return 'success';
  if (type.startsWith('conversation.')) return 'default';
  return 'secondary';
}

function summary(e: ActivityDto): string {
  const cid = e.payload['conversationId'];
  if (typeof cid === 'string') return `conv=${cid.slice(0, 12)}…`;
  return JSON.stringify(e.payload).slice(0, 80);
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
