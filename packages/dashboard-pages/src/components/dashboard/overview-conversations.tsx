'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../../api';
import { authClient } from '../../auth-client';
import { useRouter } from '../../i18n-navigation';
import { useRealtime } from '../../realtime';
import { ConsoleSectionLabel } from '../console-section-label';
import { ConversationRow } from './conversation-row';
import type { QueueItemDto } from './conversation-queue';
import { StatRow } from './overview-stat-row';

const RECENT_LIMIT = 5;

export function OverviewConversations({ liveCount }: { liveCount: number }) {
  const t = useTranslations('dashboard.overview.stats');
  const tSections = useTranslations('dashboard.overview.sections');
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const viewerUserId = session?.user?.id ?? null;
  const [recent, setRecent] = useState<QueueItemDto[]>([]);

  const loadRecent = useCallback(() => {
    void api<{ items: QueueItemDto[] }>(
      `/v1/conversations/queue?status=open&limit=${RECENT_LIMIT}`,
    )
      .then((res) => setRecent(res.items))
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (event.type.startsWith('conversation.')) loadRecent();
  });

  return (
    <section className="border-t border-t-ink dark:border-t-rule-on-dark">
      <StatRow
        href="/dashboard/conversations"
        count={liveCount}
        dot="live"
        label={t('liveLabel')}
        note={liveCount > 0 ? t('liveNoteSome') : t('liveNoteNone')}
        cta={t('liveOpen')}
      />
      <ul className="border-t border-rule-soft dark:border-rule-on-dark">
        <ConsoleSectionLabel>{tSections('conversationsRecent')}</ConsoleSectionLabel>
        {recent.length === 0 ? (
          <li className="border-b border-rule-soft px-5 py-5 text-[13px] leading-relaxed text-ink-soft dark:border-rule-on-dark dark:text-foreground/80">
            {tSections('conversationsEmpty')}
          </li>
        ) : (
          recent.map((item) => (
            <ConversationRow
              key={item.id}
              item={item}
              active={false}
              viewerUserId={viewerUserId}
              drafting={false}
              onSelect={() => router.push(`/dashboard/conversations/${item.id}`)}
            />
          ))
        )}
      </ul>
    </section>
  );
}
