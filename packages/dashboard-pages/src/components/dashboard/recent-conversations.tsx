'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../../api';
import { useRelative } from '../../lib/use-relative';
import type { InboxController } from './inbox-sections';

const MAX_ITEMS = 20;

type ConversationStatus = 'open' | 'snoozed' | 'closed' | 'spam';

interface ConversationSummary {
  id: string;
  displayId: number;
  status: ConversationStatus;
  subject: string | null;
  lastMessageAt: string | null;
  lastInboundPreview?: string | null;
  updatedAt: string;
  createdAt: string;
}

interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}

export function RecentConversationsSection({
  controller,
}: {
  controller: InboxController;
}) {
  const t = useTranslations('dashboard.overview.recentConversations');
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void (async () => {
      try {
        const page = await api<ConversationListResponse>(
          `/v1/conversations?status=open&limit=${MAX_ITEMS}`,
        );
        setItems(page.items);
      } catch (err) {
        console.warn('[dashboard] open conversations fetch failed:', err);
      }
    })();
  }, []);

  const visible = useMemo(() => {
    return items
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.lastMessageAt ?? a.updatedAt).getTime();
        const tb = new Date(b.lastMessageAt ?? b.updatedAt).getTime();
        return tb - ta;
      })
      .slice(0, MAX_ITEMS);
  }, [items]);

  if (visible.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b-[0.5px] border-rule-soft pb-2.5 dark:border-rule-on-dark">
        <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink dark:text-foreground">
          {t('eyebrow')} · {visible.length}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('meta')}
        </span>
      </div>
      <ul>
        {visible.map((c) => (
          <ConversationRow
            key={c.id}
            conv={c}
            onOpen={() => controller.setConvDrawer({ id: c.id, mode: 'full' })}
          />
        ))}
      </ul>
    </section>
  );
}

function ConversationRow({
  conv,
  onOpen,
}: {
  conv: ConversationSummary;
  onOpen: () => void;
}) {
  const t = useTranslations('dashboard.overview.recentConversations');
  const age = useRelative();
  const title = conv.subject?.trim() || t('untitled', { displayId: conv.displayId });
  const preview = conv.lastInboundPreview?.trim() || null;
  const ts = conv.lastMessageAt ?? conv.updatedAt;

  return (
    <li className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark">
      <div
        className="group/cnvrow relative flex items-center gap-4 px-4 py-3 transition-colors duration-fast ease-munin hover:bg-paper-deep cursor-pointer dark:hover:bg-secondary"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="min-w-0 flex-1 truncate">
          <span className="text-sm font-medium text-ink dark:text-foreground">{title}</span>
          {preview ? (
            <span className="ml-2 text-sm text-ink-mute"> — {preview}</span>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {age(ts)}
        </span>
      </div>
    </li>
  );
}
