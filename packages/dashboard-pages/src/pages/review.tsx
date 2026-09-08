'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn, Tabs, TabsList, TabsPanel, TabsTrigger } from '@getmunin/ui';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { usePathname, useRouter } from '../i18n-navigation';
import { useInboxData } from '../components/dashboard/inbox-data';
import { ScheduledCancelDialog } from '../components/dashboard/scheduled-cancel-dialog';
import { partitionReviewQueue } from '../components/dashboard/review-queue';
import { ReviewRow } from '../components/dashboard/review-row';
import { ReviewKbPane } from '../components/dashboard/review-kb-pane';
import { ReviewBlockingPane } from '../components/dashboard/review-blocking-pane';
import { ReviewDecidedRow } from '../components/dashboard/review-decided-row';
import { ReviewDecidedPane } from '../components/dashboard/review-decided-pane';
import { ReviewScheduledRow } from '../components/dashboard/review-scheduled-row';
import { ReviewScheduledPane } from '../components/dashboard/review-scheduled-pane';
import {
  DECIDED_WINDOW_DAYS,
  useCurationDecisions,
  withinDecidedWindow,
} from '../components/dashboard/curation-decisions';
import { useProvideMobileBack } from '../shells/mobile-back';
import { ConsoleSectionLabel } from '../components/console-section-label';
import { ConsoleListEmpty } from '../components/console-empty';
import { ConsoleRowsSkeleton, ConsoleSplitSkeleton } from '../components/console-skeleton';
import { ReviewFirstRun, useFirstRunGate } from '../components/first-run';

const ROOT = '/dashboard/review';
const FADE_FLOOR = 0.55;
const SPLIT_BREAKPOINT = '(min-width: 768px)';
const SPLIT_GRID = 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]';

type ReviewTab = 'waiting' | 'scheduled' | 'decided';

export function ReviewPage({ selectedId = null }: { selectedId?: string | null }) {
  const t = useTranslations('dashboard.console.review');
  const router = useRouter();
  const pathname = usePathname();
  const inbox = useInboxData();
  const decisions = useCurationDecisions();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const { setActiveQueueItem, setActiveScheduledItem } = inbox;

  const isDesktop = useIsDesktopSplit();

  const onListRoute = pathname === ROOT || pathname === `${ROOT}/`;
  const routeSelectedId =
    pathname.match(/^\/dashboard\/review\/([^/]+)\/?$/)?.[1] ?? (onListRoute ? null : selectedId);

  const shallowGo = useCallback(
    (path: string, replace = false) => {
      const { pathname: full } = window.location;
      const cut = full.indexOf(ROOT);
      if (cut < 0) {
        router.push(path);
        return;
      }
      const url = full.slice(0, cut) + path;
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    },
    [router],
  );
  const onListScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    const p = max > 0 ? Math.min(1, el.scrollTop / max) : 1;
    el.style.setProperty('--qfade', String(FADE_FLOOR + (1 - FADE_FLOOR) * p));
  };

  const goToList = useCallback(() => shallowGo(ROOT), [shallowGo]);
  const select = useCallback(
    (id: string, replace = false) => shallowGo(`${ROOT}/${id}`, replace),
    [shallowGo],
  );

  const { blocking, improvements } = useMemo(
    () => partitionReviewQueue(inbox.queue),
    [inbox.queue],
  );
  const recentDecisions = useMemo(
    () => decisions.items.filter((d) => withinDecidedWindow(d.decidedAt)),
    [decisions.items],
  );

  const scheduled = inbox.scheduled;

  const activeId = routeSelectedId;
  const selectedBlocking = activeId ? blocking.find((b) => b.id === activeId) : undefined;
  const selectedCandidate = activeId
    ? improvements.find((c) => c.id === activeId)
    : undefined;
  const selectedScheduled = activeId ? scheduled.find((s) => s.id === activeId) : undefined;
  const selectedDecision = activeId ? recentDecisions.find((d) => d.id === activeId) : undefined;

  useEffect(() => {
    setActiveQueueItem(selectedBlocking ?? null);
  }, [selectedBlocking, setActiveQueueItem]);

  useEffect(() => {
    setActiveScheduledItem(selectedScheduled ?? null);
  }, [selectedScheduled, setActiveScheduledItem]);

  const listLoaded = inbox.hasLoadedOnce && decisions.hasLoadedOnce;
  const nothingToReview =
    blocking.length === 0 &&
    improvements.length === 0 &&
    scheduled.length === 0 &&
    recentDecisions.length === 0;
  const gate = useFirstRunGate({ firstRun: () => (listLoaded ? nothingToReview : null) });
  const idsByTab: Record<ReviewTab, string[]> = useMemo(
    () => ({
      waiting: [...blocking.map((b) => b.id), ...improvements.map((c) => c.id)],
      scheduled: scheduled.map((s) => s.id),
      decided: recentDecisions.map((d) => d.id),
    }),
    [blocking, improvements, scheduled, recentDecisions],
  );

  const owningTab = useMemo(() => {
    if (!routeSelectedId) return null;
    const found = (['waiting', 'scheduled', 'decided'] as const).find((key) =>
      idsByTab[key].includes(routeSelectedId),
    );
    return found ?? null;
  }, [routeSelectedId, idsByTab]);

  const [chosenTab, setChosenTab] = useState<ReviewTab>('waiting');
  const tab = owningTab ?? chosenTab;

  useEffect(() => {
    if (owningTab) setChosenTab(owningTab);
  }, [owningTab]);

  useEffect(() => {
    if (!routeSelectedId) return;
    if (!listLoaded) return;
    if (owningTab) return;
    goToList();
  }, [routeSelectedId, owningTab, listLoaded, goToList]);

  const activeIds = idsByTab[tab];
  useEffect(() => {
    if (routeSelectedId) return;
    if (!listLoaded) return;
    if (!isDesktop) return;
    const first = activeIds[0];
    if (!first) return;
    select(first, true);
  }, [routeSelectedId, listLoaded, isDesktop, activeIds, select]);

  const changeTab = useCallback(
    (next: ReviewTab) => {
      setChosenTab(next);
      goToList();
    },
    [goToList],
  );

  const backAction = useMemo(() => {
    if (!routeSelectedId) return null;
    const title =
      selectedBlocking?.title ??
      selectedCandidate?.title ??
      selectedScheduled?.title ??
      selectedDecision?.title;
    return { label: t('backToList'), title, onBack: goToList };
  }, [
    routeSelectedId,
    selectedBlocking,
    selectedCandidate,
    selectedScheduled,
    selectedDecision,
    goToList,
    t,
  ]);
  useProvideMobileBack(backAction);

  if (inbox.loadError && !inbox.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
        />
      </div>
    );
  }

  if (gate.view === 'loading') return <ConsoleSplitSkeleton grid={SPLIT_GRID} lede />;
  if (gate.view === 'firstRun') {
    return <ReviewFirstRun setup={gate.setup} decidedCount={decisions.items.length} />;
  }

  const afterDecision = (ok: boolean) => {
    if (ok) void decisions.reload();
  };

  return (
    <div className={cn('grid h-full min-h-0 grid-cols-1', SPLIT_GRID)}>
      <section
        onScroll={onListScroll}
        className={cn(
          'flex min-h-0 flex-col border-r border-ink max-md:overflow-y-auto dark:border-rule-on-dark',
          routeSelectedId ? 'max-md:hidden' : '',
        )}
      >
        <header className="shrink-0 border-b border-rule-soft px-5 pb-4 pt-6 dark:border-rule-on-dark">
          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {t('eyebrow')}
          </div>
          <h1 className="mb-2 mt-1 font-serif text-[26px] font-normal leading-[1.05] tracking-tight text-ink md:text-[28px] dark:text-foreground">
            {t.rich('title', {
              em: (chunks) => (
                <em className="italic text-cobalt dark:text-cobalt-soft">{chunks}</em>
              ),
            })}
          </h1>
          <p className="max-w-[42ch] text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">
            {t('lede')}
          </p>
        </header>

        <Tabs
          value={tab}
          onValueChange={(next) => changeTab(next as ReviewTab)}
          className="flex min-h-0 flex-col md:flex-1"
        >
          <TabsList className="w-full shrink-0 gap-5 px-5">
            <TabsTrigger value="waiting" className="px-0">
              {t('tabWaiting')}
              {idsByTab.waiting.length > 0 ? (
                <span className="ml-1.5 text-ink-mute"> · {idsByTab.waiting.length}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="scheduled" className="px-0">
              {t('tabScheduled')}
              {scheduled.length > 0 ? (
                <span className="ml-1.5 text-ink-mute"> · {scheduled.length}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="decided" className="px-0">
              {t('tabDecided')}
            </TabsTrigger>
          </TabsList>

          <TabsPanel
            value="waiting"
            onScroll={onListScroll}
            className="mt-0 md:min-h-0 md:flex-1 md:overflow-y-auto"
          >
            <ul className="pb-6">
              {!listLoaded ? (
                <ConsoleRowsSkeleton />
              ) : (
                <>
                  <ConsoleSectionLabel
                    note={blocking.length > 0 ? t('sectionBlockingNote') : undefined}
                  >
                    {t('sectionBlocking', { count: blocking.length })}
                  </ConsoleSectionLabel>
                  {blocking.length === 0 ? (
                    <ConsoleListEmpty body={t('emptyBlockingBody')} />
                  ) : (
                    blocking.map((item) => (
                      <ReviewRow
                        key={`${item.kind}-${item.id}`}
                        item={item}
                        active={item.id === activeId}
                        onSelect={() => select(item.id)}
                      />
                    ))
                  )}

                  <ConsoleSectionLabel
                    note={improvements.length > 0 ? t('sectionImprovementsNote') : undefined}
                  >
                    {t('sectionImprovements', { count: improvements.length })}
                  </ConsoleSectionLabel>
                  {improvements.length === 0 ? (
                    <ConsoleListEmpty body={t('emptyImprovementsBody')} />
                  ) : (
                    improvements.map((item) => (
                      <ReviewRow
                        key={`${item.kind}-${item.id}`}
                        item={item}
                        active={item.id === activeId}
                        onSelect={() => select(item.id)}
                      />
                    ))
                  )}
                </>
              )}
            </ul>
          </TabsPanel>

          <TabsPanel
            value="scheduled"
            onScroll={onListScroll}
            className="mt-0 md:min-h-0 md:flex-1 md:overflow-y-auto"
          >
            <ul className="pb-6">
              {!listLoaded ? (
                <ConsoleRowsSkeleton rows={3} />
              ) : scheduled.length === 0 ? (
                <ConsoleListEmpty title={t('emptyScheduledTitle')} body={t('emptyScheduledBody')} />
              ) : (
                scheduled.map((item) => (
                  <ReviewScheduledRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    active={item.id === activeId}
                    onSelect={() => select(item.id)}
                  />
                ))
              )}
            </ul>
          </TabsPanel>

          <TabsPanel
            value="decided"
            onScroll={onListScroll}
            className="mt-0 md:min-h-0 md:flex-1 md:overflow-y-auto"
          >
            <ul className="pb-6">
              {!listLoaded ? (
                <ConsoleRowsSkeleton rows={3} />
              ) : recentDecisions.length === 0 ? (
                <ConsoleListEmpty
                  title={t('emptyDecidedTitle')}
                  body={t('emptyDecidedBody', { days: DECIDED_WINDOW_DAYS })}
                />
              ) : (
                recentDecisions.map((item) => (
                  <ReviewDecidedRow
                    key={item.id}
                    item={item}
                    active={item.id === activeId}
                    faded
                    onSelect={() => select(item.id)}
                  />
                ))
              )}
            </ul>
          </TabsPanel>
        </Tabs>
      </section>

      <div
        className={cn(
          'min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]',
          routeSelectedId ? 'grid' : 'hidden md:grid',
        )}
      >
        {!activeId ? (
          <section className="hidden min-h-0 flex-col bg-paper-deep md:flex dark:bg-secondary">
            {activeIds.length > 0 ? (
              <span className="p-8 font-mono text-[11px] uppercase tracking-eyebrow text-ink-mute">
                {t('selectEmpty')}
              </span>
            ) : (
              <PaneEmpty
                eyebrow={t('paneEmptyEyebrow')}
                title={t('paneEmpty')}
                body={t('paneEmptyBody', { days: DECIDED_WINDOW_DAYS })}
              />
            )}
          </section>
        ) : selectedBlocking ? (
          <ReviewBlockingPane
            item={selectedBlocking}
            controller={inbox}
            afterDecision={afterDecision}
          />
        ) : selectedScheduled ? (
          <ReviewScheduledPane item={selectedScheduled} controller={inbox} />
        ) : selectedDecision ? (
          <ReviewDecidedPane
            item={selectedDecision}
            publishedDoc={
              selectedDecision.publishedDocumentId
                ? decisions.publishedDocs[selectedDecision.publishedDocumentId]
                : undefined
            }
            publishedDocFailed={
              !!selectedDecision.publishedDocumentId &&
              !!decisions.publishedDocErrors[selectedDecision.publishedDocumentId]
            }
            onLoadPublishedDoc={(id) => void decisions.loadPublishedDoc(id)}
          />
        ) : (
          <ReviewKbPane
            item={selectedCandidate}
            pending={inbox.pending}
            actionError={inbox.queueActionError}
            onClearActionError={inbox.clearQueueActionError}
            onPublish={() => {
              if (selectedCandidate) {
                void inbox.approveQueue(selectedCandidate).then(afterDecision);
              }
            }}
            onDismiss={() => {
              if (selectedCandidate) {
                void inbox.dismissQueue(selectedCandidate).then(afterDecision);
              }
            }}
          />
        )}
      </div>

      <ScheduledCancelDialog controller={inbox} />
    </div>
  );
}

function useIsDesktopSplit(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(SPLIT_BREAKPOINT);
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isDesktop;
}

function PaneEmpty({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="px-5 pt-6 md:px-7">
      <div className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-mute">
        {eyebrow}
      </div>
      <h2 className="mb-2 mt-1 font-serif text-[26px] font-normal leading-[1.05] tracking-tight text-ink md:text-[28px] dark:text-foreground">
        {title}
      </h2>
      <p className="max-w-[42ch] text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">
        {body}
      </p>
    </div>
  );
}
