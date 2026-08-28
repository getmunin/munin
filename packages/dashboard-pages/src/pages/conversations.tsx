'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { useRouter } from '../i18n-navigation';
import {
  matchesQueueSearch,
  partitionQueue,
  useConversationQueue,
  type QueueItemDto,
} from '../components/dashboard/conversation-queue';
import { ConversationRow } from '../components/dashboard/conversation-row';
import { ConversationPane } from '../components/dashboard/conversation-pane';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-5 pb-2 pt-4 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
      {children}
    </li>
  );
}

export function ConversationsPage({ selectedId = null }: { selectedId?: string | null }) {
  const t = useTranslations('dashboard.console.queue');
  const router = useRouter();
  const queue = useConversationQueue(selectedId);
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const { data: session } = authClient.useSession();
  const viewerUserId = session?.user?.id ?? null;
  const [search, setSearch] = useState('');

  const sections = useMemo(() => {
    const bySearch = (item: QueueItemDto) => matchesQueueSearch(item, search);
    const parts = partitionQueue(queue.open, queue.finished, viewerUserId);
    return {
      needsYou: parts.needsYou.filter(bySearch),
      inProgress: parts.inProgress.filter(bySearch),
      finished: parts.finished.filter(bySearch),
    };
  }, [queue.open, queue.finished, viewerUserId, search]);

  if (queue.loadError && !queue.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(queue.loadError, () => void queue.retryLoad(), queue.retrying)}
        />
      </div>
    );
  }

  const select = (id: string) => router.push(`/dashboard/conversations/${id}`);
  const activeId = queue.selectedId;
  const selectedItem = activeId
    ? [...queue.open, ...queue.finished].find((i) => i.id === activeId)
    : undefined;

  const renderRows = (items: QueueItemDto[]) =>
    items.map((item) => (
      <ConversationRow
        key={item.id}
        item={item}
        active={item.id === activeId}
        viewerUserId={viewerUserId}
        drafting={!!queue.draftRequested[item.id]}
        onSelect={() => select(item.id)}
      />
    ));

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1.4fr)]">
      <section
        className={cn(
          'flex min-h-0 flex-col border-r border-ink dark:border-rule-on-dark',
          selectedId ? 'max-md:hidden' : '',
        )}
      >
        <header className="shrink-0 border-b border-ink px-5 pb-3.5 pt-6 md:px-6 dark:border-rule-on-dark">
          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {t('eyebrow')}
          </div>
          <h1 className="mb-2.5 mt-1 truncate font-serif text-[28px] font-normal leading-tight tracking-tight text-ink md:text-3xl dark:text-foreground">
            {t.rich('title', {
              em: (chunks) => (
                <em className="italic text-cobalt dark:text-cobalt-soft">{chunks}</em>
              ),
            })}
          </h1>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-input border border-rule-soft bg-paper px-2.5 py-2 text-base outline-none focus-visible:border-cobalt md:py-1.5 md:text-[12.5px] dark:border-rule-on-dark dark:bg-card"
          />
        </header>
        <div className="flex shrink-0 flex-wrap gap-x-2.5 gap-y-1 border-b border-rule-soft px-5 py-2.5 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute md:px-6 dark:border-rule-on-dark">
          <span className="whitespace-nowrap">{t('metaNeedYou', { count: sections.needsYou.length })}</span>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">{t('metaOpen', { count: sections.inProgress.length })}</span>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">{t('metaDone', { count: sections.finished.length })}</span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto pb-6">
          <SectionLabel>{t('sectionNeedsYou', { count: sections.needsYou.length })}</SectionLabel>
          {sections.needsYou.length === 0 ? (
            <li className="border-b border-rule-soft px-5 pb-5 pt-1 font-serif text-lg italic text-ink-soft dark:border-rule-on-dark dark:text-foreground/80">
              {t.rich('emptyNeedsYou', {
                em: (chunks) => <span className="text-cobalt dark:text-cobalt-soft">{chunks}</span>,
              })}
            </li>
          ) : (
            renderRows(sections.needsYou)
          )}
          <SectionLabel>{t('sectionInProgress', { count: sections.inProgress.length })}</SectionLabel>
          {renderRows(sections.inProgress)}
          <SectionLabel>{t('sectionFinished', { count: sections.finished.length })}</SectionLabel>
          {sections.finished.length === 0 ? (
            <li className="px-5 pb-5 pt-1 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
              {t('emptyFinished')}
            </li>
          ) : (
            renderRows(sections.finished)
          )}
        </ul>
      </section>

      <div className={cn('min-h-0', selectedId ? 'grid' : 'hidden md:grid')}>
        <ConversationPane
          selectedId={activeId}
          item={selectedItem}
          detail={activeId ? queue.details[activeId] : undefined}
          controller={queue}
          viewerUserId={viewerUserId}
          onBack={() => router.push('/dashboard/conversations')}
        />
      </div>
    </div>
  );
}
