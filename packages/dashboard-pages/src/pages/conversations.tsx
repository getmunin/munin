'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { usePathname, useRouter } from '../i18n-navigation';
import {
  matchesQueueSearch,
  partitionQueue,
  useConversationQueue,
  type QueueItemDto,
} from '../components/dashboard/conversation-queue';
import { ConversationRow } from '../components/dashboard/conversation-row';
import { ConversationPane } from '../components/dashboard/conversation-pane';
import { useProvideMobileBack } from '../shells/mobile-back';

const FADE_FLOOR = 0.55;

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
  const pathname = usePathname();
  const onQueueRoute = /^\/dashboard\/conversations\/?$/.test(pathname);
  const routeSelectedId =
    pathname.match(/^\/dashboard\/conversations\/([^/]+)/)?.[1] ??
    (onQueueRoute ? null : selectedId);
  const queue = useConversationQueue(routeSelectedId);
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const { data: session } = authClient.useSession();
  const viewerUserId = session?.user?.id ?? null;
  const [search, setSearch] = useState('');

  const onListScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    const p = max > 0 ? Math.min(1, el.scrollTop / max) : 1;
    el.style.setProperty('--qfade', String(FADE_FLOOR + (1 - FADE_FLOOR) * p));
  };

  const sections = useMemo(() => {
    const bySearch = (item: QueueItemDto) => matchesQueueSearch(item, search);
    const parts = partitionQueue(queue.open, queue.finished, viewerUserId);
    return {
      needsYou: parts.needsYou.filter(bySearch),
      inProgress: parts.inProgress.filter(bySearch),
      finished: parts.finished.filter(bySearch),
    };
  }, [queue.open, queue.finished, viewerUserId, search]);

  const shallowGo = useCallback(
    (path: string) => {
      const { pathname: full } = window.location;
      const cut = full.indexOf('/dashboard/conversations');
      if (cut < 0) {
        router.push(path);
        return;
      }
      window.history.pushState(null, '', full.slice(0, cut) + path);
    },
    [router],
  );
  const goToQueue = useCallback(
    () => shallowGo('/dashboard/conversations'),
    [shallowGo],
  );

  const activeId = queue.selectedId;
  const selectedItem = activeId
    ? [...queue.open, ...queue.finished].find((i) => i.id === activeId)
    : undefined;
  const backAction = useMemo(() => {
    if (!routeSelectedId) return null;
    const customer = selectedItem?.customerName ?? null;
    const title = selectedItem?.subject ?? customer ?? undefined;
    const meta = [selectedItem?.topicName, selectedItem?.subject ? customer : null]
      .filter((v): v is string => !!v)
      .join(' · ');
    return { label: t('backToQueue'), title, meta: meta || undefined, onBack: goToQueue };
  }, [routeSelectedId, selectedItem, goToQueue, t]);
  useProvideMobileBack(backAction);

  if (queue.loadError && !queue.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(queue.loadError, () => void queue.retryLoad(), queue.retrying)}
        />
      </div>
    );
  }

  const select = (id: string) => shallowGo(`/dashboard/conversations/${id}`);

  const renderRows = (items: QueueItemDto[], faded?: boolean) =>
    items.map((item) => (
      <ConversationRow
        key={item.id}
        item={item}
        faded={faded && item.claim?.holderId !== viewerUserId}
        active={item.id === activeId}
        viewerUserId={viewerUserId}
        drafting={!!queue.draftRequested[item.id]}
        onSelect={() => select(item.id)}
      />
    ));

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1.4fr)]">
      <section
        onScroll={onListScroll}
        className={cn(
          'flex min-h-0 flex-col border-r border-ink max-md:overflow-y-auto dark:border-rule-on-dark',
          routeSelectedId ? 'max-md:hidden' : '',
        )}
      >
        <header className="shrink-0 border-b border-ink px-5 pb-3.5 pt-6 md:min-h-[146px] md:px-6 dark:border-rule-on-dark">
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
        <ul onScroll={onListScroll} className="pb-6 md:min-h-0 md:flex-1 md:overflow-y-auto">
          {sections.needsYou.length > 0 ? (
            <>
              <SectionLabel>{t('sectionNeedsYou', { count: sections.needsYou.length })}</SectionLabel>
              {renderRows(sections.needsYou)}
            </>
          ) : null}
          {sections.inProgress.length > 0 ? (
            <>
              <SectionLabel>{t('sectionInProgress', { count: sections.inProgress.length })}</SectionLabel>
              {renderRows(sections.inProgress, true)}
            </>
          ) : null}
          {sections.finished.length > 0 ? (
            <>
              <SectionLabel>{t('sectionFinished', { count: sections.finished.length })}</SectionLabel>
              {renderRows(sections.finished, true)}
            </>
          ) : null}
        </ul>
      </section>

      <div
        className={cn('min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]', routeSelectedId ? 'grid' : 'hidden md:grid')}
      >
        <ConversationPane
          selectedId={activeId}
          item={selectedItem}
          detail={activeId ? queue.details[activeId] : undefined}
          controller={queue}
          viewerUserId={viewerUserId}
        />
      </div>
    </div>
  );
}
