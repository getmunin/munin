'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, MessageSquare, ShieldCheck, Unplug } from 'lucide-react';
import { Badge, Button, Card, CardContent, Label, Separator } from '@getmunin/ui';
import { api, ApiError } from '../api';
import { useRealtime, type SubscriptionChannel } from '../realtime';

const POLL_MS = 30_000;
const STATUSES = ['open', 'snoozed', 'closed', 'spam'] as const;
type Status = (typeof STATUSES)[number];

interface ConversationSummary {
  id: string;
  displayId: number;
  status: Status;
  channelId: string;
  endUserId: string | null;
  contactId: string | null;
  topicId: string | null;
  assigneeUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  needsHumanAttention: boolean;
  needsHumanAttentionAt: string | null;
  updatedAt: string;
  createdAt: string;
}

interface MessageDto {
  id: string;
  conversationId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
  authorId: string;
  body: string;
  internal: boolean;
  inReplyToId: string | null;
  attachments: unknown[];
  createdAt: string;
}

interface ConversationDetail extends ConversationSummary {
  messages: MessageDto[];
  claim: { holderType: 'user' | 'agent'; holderId: string; expiresAt: string } | null;
}

interface ActivityDto {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function ConversationsPage() {
  const [filters, setFilters] = useState<{
    needsHumanAttention: boolean;
    status: Status | '';
  }>({ needsHumanAttention: false, status: '' });
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const buildListParams = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      if (filters.needsHumanAttention) params.set('needsHumanAttention', 'true');
      if (filters.status) params.set('status', filters.status);
      if (cursor) params.set('cursor', cursor);
      return params;
    },
    [filters],
  );

  const loadList = useCallback(async () => {
    try {
      const page = await api<{ items: ConversationSummary[]; nextCursor: string | null }>(
        `/api/conversations?${buildListParams(null).toString()}`,
      );
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
      if (selectedId === null && page.items[0]) setSelectedId(page.items[0].id);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [buildListParams, selectedId]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const page = await api<{ items: ConversationSummary[]; nextCursor: string | null }>(
        `/api/conversations?${buildListParams(nextCursor).toString()}`,
      );
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [buildListParams, nextCursor]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api<ConversationDetail>(`/api/conversations/${id}`);
      setDetail(d);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void loadList();
    const t = setInterval(() => void loadList(), POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
    const t = setInterval(() => void loadDetail(selectedId), POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => {
    const subs: SubscriptionChannel[] = [{ channel: 'org' }];
    if (selectedId) subs.push({ channel: 'conversation', id: selectedId });
    return subs;
  }, [selectedId]);

  useRealtime(subscriptions, (event) => {
    if (!event.type.startsWith('conversation.')) return;
    const eventConvId = event.payload['conversationId'];
    if (typeof eventConvId !== 'string') return;
    void loadList();
    if (selectedId && eventConvId === selectedId) void loadDetail(selectedId);
  });

  async function takeOver() {
    if (!selectedId) return;
    setPending(true);
    try {
      await api(`/api/conversations/${selectedId}/take-over`, {
        method: 'POST',
        body: '{}',
      });
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function release() {
    if (!selectedId) return;
    setPending(true);
    try {
      await api(`/api/conversations/${selectedId}/release`, {
        method: 'POST',
        body: '{}',
      });
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function close() {
    if (!selectedId) return;
    setPending(true);
    try {
      await api(`/api/conversations/${selectedId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'closed' }),
      });
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function send() {
    if (!selectedId || !reply.trim()) return;
    const body = reply.trim();
    const temp: MessageDto = {
      id: `pending-${Date.now()}`,
      conversationId: selectedId,
      authorType: 'user',
      authorId: 'me',
      body,
      internal: false,
      inReplyToId: null,
      attachments: [],
      createdAt: new Date().toISOString(),
    };
    setReply('');
    setDetail((d) => (d ? { ...d, messages: [...d.messages, temp] } : d));
    setPending(true);
    try {
      await api(`/api/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (err) {
      setError(messageOf(err));
      setDetail((d) =>
        d ? { ...d, messages: d.messages.filter((m) => m.id !== temp.id) } : d,
      );
      setReply(body);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-3">
      <FiltersPane filters={filters} setFilters={setFilters} />
      <ListPane
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        error={error}
        hasMore={nextCursor !== null}
        onLoadMore={() => void loadMore()}
      />
      <DetailPane
        detail={detail}
        reply={reply}
        setReply={setReply}
        pending={pending}
        onSend={() => void send()}
        onTakeOver={() => void takeOver()}
        onRelease={() => void release()}
        onClose={() => void close()}
      />
    </div>
  );
}

function FiltersPane({
  filters,
  setFilters,
}: {
  filters: { needsHumanAttention: boolean; status: Status | '' };
  setFilters: (
    update: (
      f: { needsHumanAttention: boolean; status: Status | '' },
    ) => { needsHumanAttention: boolean; status: Status | '' },
  ) => void;
}) {
  return (
    <aside className="hidden w-48 shrink-0 flex-col gap-4 lg:flex">
      <div>
        <h2 className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Filters
        </h2>
      </div>
      <div className="space-y-2 px-2">
        <button
          type="button"
          onClick={() =>
            setFilters((f) => ({ ...f, needsHumanAttention: !f.needsHumanAttention }))
          }
          className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
            filters.needsHumanAttention
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
              : 'hover:bg-muted'
          }`}
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="size-3.5" />
            Needs attention
          </span>
        </button>
        <Separator />
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Status</Label>
        <div className="space-y-1">
          {(['', ...STATUSES] as const).map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status: s }))}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-sm capitalize ${
                filters.status === s ? 'bg-muted font-medium' : 'hover:bg-muted'
              }`}
            >
              {s || 'all'}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ListPane({
  items,
  selectedId,
  onSelect,
  error,
  hasMore,
  onLoadMore,
}: {
  items: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-2 overflow-hidden rounded-lg border bg-background">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </header>
      {error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}
      <ul className="flex-1 overflow-y-auto">
        {items.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={`flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted ${
                selectedId === c.id ? 'bg-muted' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">#{c.displayId}</span>
                <span className="text-xs text-muted-foreground">
                  {c.lastMessageAt ? relative(c.lastMessageAt) : ''}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {c.needsHumanAttention && (
                  <Badge variant="warning">
                    <AlertCircle className="size-3" />
                    needs attention
                  </Badge>
                )}
                <span className="truncate text-xs text-muted-foreground">
                  {c.subject ?? c.status}
                </span>
              </div>
            </button>
          </li>
        ))}
        {items.length === 0 && !error && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            No conversations match these filters.
          </li>
        )}
        {hasMore && (
          <li className="px-3 py-2">
            <Button variant="outline" size="sm" className="w-full" onClick={onLoadMore}>
              Load more
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}

function DetailPane({
  detail,
  reply,
  setReply,
  pending,
  onSend,
  onTakeOver,
  onRelease,
  onClose,
}: {
  detail: ConversationDetail | null;
  reply: string;
  setReply: (v: string) => void;
  pending: boolean;
  onSend: () => void;
  onTakeOver: () => void;
  onRelease: () => void;
  onClose: () => void;
}) {
  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border bg-background text-sm text-muted-foreground">
        <MessageSquare className="mr-2 size-4" /> Select a conversation
      </div>
    );
  }

  const claimed = detail.claim !== null;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden p-px">
      <Card className="flex-1 gap-0 overflow-hidden py-0">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-semibold">
              {detail.subject ?? `Conversation #${detail.displayId}`}
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="capitalize">{detail.status}</span>
              {detail.needsHumanAttention && (
                <Badge variant="warning">
                  <AlertCircle className="size-3" /> needs attention
                </Badge>
              )}
              {claimed && (
                <Badge variant="success">
                  <ShieldCheck className="size-3" /> taken over
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {!claimed ? (
              <Button size="sm" onClick={onTakeOver} disabled={pending}>
                Take over
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onRelease} disabled={pending}>
                <Unplug className="size-3.5" /> Release
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
              Close
            </Button>
          </div>
        </header>
        <CardContent className="flex h-full flex-col gap-2 overflow-y-auto p-4">
          {detail.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </CardContent>
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              placeholder="Reply…"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button onClick={onSend} disabled={pending || !reply.trim()}>
              Send
            </Button>
          </div>
        </div>
      </Card>
      <ActivitySidebar contactId={detail.contactId} conversationId={detail.id} />
    </div>
  );
}

function MessageBubble({ message }: { message: MessageDto }) {
  const isOutbound = message.authorType === 'user' || message.authorType === 'agent';
  const isSystem = message.authorType === 'system';

  if (isSystem) {
    return (
      <div className="self-center rounded-md bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
        {message.body}
      </div>
    );
  }
  if (message.internal) {
    return (
      <div
        className={`max-w-[80%] self-${isOutbound ? 'end' : 'start'} rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10`}
      >
        <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-200">
          <AlertCircle className="size-3" /> internal · {message.authorType}
        </div>
        <div className="whitespace-pre-wrap">{message.body}</div>
      </div>
    );
  }
  return (
    <div
      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
        isOutbound
          ? 'self-end bg-blue-500 text-white dark:bg-blue-500'
          : 'self-start bg-muted'
      }`}
    >
      <div
        className={`mb-0.5 text-[10px] uppercase tracking-wide ${
          isOutbound ? 'text-blue-100' : 'text-muted-foreground'
        }`}
      >
        {message.authorType}
      </div>
      <div className="whitespace-pre-wrap">{message.body}</div>
    </div>
  );
}

function ActivitySidebar({
  contactId,
  conversationId,
}: {
  contactId: string | null;
  conversationId: string;
}) {
  const [events, setEvents] = useState<ActivityDto[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const param = contactId ? `contactId=${contactId}` : `conversationId=${conversationId}`;
    let cancelled = false;
    const tick = async () => {
      try {
        const page = await api<{ items: ActivityDto[] }>(`/api/activity?${param}&limit=20`);
        if (!cancelled) {
          setEvents(page.items);
          last.current = page.items[0]?.id ?? null;
        }
      } catch {
        return;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [contactId, conversationId]);

  return (
    <Card className="max-h-64 gap-0 overflow-hidden py-0">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {contactId ? 'Contact activity' : 'Conversation activity'}
        </h3>
        <Button size="xs" variant="ghost" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? 'Expand' : 'Collapse'}
        </Button>
      </header>
      {!collapsed && (
        <CardContent className="max-h-48 space-y-1 overflow-y-auto p-2 text-xs">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-2 px-1 py-0.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                {relative(e.createdAt)}
              </span>
              <span>{e.type}</span>
            </div>
          ))}
          {events.length === 0 && (
            <div className="px-1 py-2 text-muted-foreground">No activity yet.</div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function relative(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}
