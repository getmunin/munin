'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../../api';
import { useRelative } from '../../lib/use-relative';
import { useRealtime, type SubscriptionChannel } from '../../realtime';
import type { ActivityDto } from './inbox-types';

export function ActivityRail({
  contactId,
  conversationId,
}: {
  contactId: string | null;
  conversationId: string;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const [events, setEvents] = useState<ActivityDto[]>([]);
  const [open, setOpen] = useState(false);
  const last = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const param = contactId ? `contactId=${contactId}` : `conversationId=${conversationId}`;
    try {
      const page = await api<{ items: ActivityDto[] }>(`/v1/activity?${param}&limit=20`);
      setEvents(page.items);
      last.current = page.items[0]?.id ?? null;
    } catch (err) {
      console.warn('[inbox/activity-rail] refresh failed', err);
      return;
    }
  }, [contactId, conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const railSubs = useMemo<SubscriptionChannel[]>(
    () =>
      contactId
        ? [{ channel: 'contact', id: contactId }]
        : [{ channel: 'conversation', id: conversationId }],
    [contactId, conversationId],
  );
  useRealtime(railSubs, () => {
    void refresh();
  });

  return (
    <div className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-ink dark:hover:text-foreground"
      >
        <span>{contactId ? t('activityContact') : t('activityConv')}</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="max-h-48 space-y-1 overflow-y-auto px-6 pb-3 text-xs">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className="font-mono text-[10px] text-ink-mute">{age(e.createdAt)}</span>
              <span>{e.type}</span>
            </li>
          ))}
          {events.length === 0 && (
            <li className="text-ink-mute font-serif italic">{t('activityEmpty')}</li>
          )}
        </ul>
      )}
    </div>
  );
}
