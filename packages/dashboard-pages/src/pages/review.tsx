'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { usePathname, useRouter } from '../i18n-navigation';
import { useInboxData } from '../components/dashboard/inbox-sections';
import { partitionReviewQueue } from '../components/dashboard/review-queue';
import { ReviewRow } from '../components/dashboard/review-row';
import { ReviewKbPane } from '../components/dashboard/review-kb-pane';
import { ReviewBlockingPane } from '../components/dashboard/review-blocking-pane';
import { ReviewDecidedRow } from '../components/dashboard/review-decided-row';
import { ReviewDecidedPane } from '../components/dashboard/review-decided-pane';
import {
  DECIDED_WINDOW_DAYS,
  useCurationDecisions,
  withinDecidedWindow,
} from '../components/dashboard/curation-decisions';
import { useProvideMobileBack } from '../shells/mobile-back';
import { ConsoleSectionLabel } from '../components/console-section-label';
import { ReviewFirstRun, useSetupState } from '../components/first-run';

const ROOT = '/dashboard/review';
const FADE_FLOOR = 0.55;
const SPLIT_BREAKPOINT = '(min-width: 768px)';

export function ReviewPage({ selectedId = null }: { selectedId?: string | null }) {
  const t = useTranslations('dashboard.console.review');
  const router = useRouter();
  const pathname = usePathname();
  const inbox = useInboxData();
  const setup = useSetupState();
  const decisions = useCurationDecisions();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const { setQueueDrawer } = inbox;

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

  const activeId = routeSelectedId;
  const selectedBlocking = activeId ? blocking.find((b) => b.id === activeId) : undefined;
  const selectedCandidate = activeId
    ? improvements.find((c) => c.id === activeId)
    : undefined;
  const selectedDecision = activeId ? recentDecisions.find((d) => d.id === activeId) : undefined;

  useEffect(() => {
    setQueueDrawer(selectedBlocking ?? null);
  }, [selectedBlocking, setQueueDrawer]);

  const listLoaded = inbox.hasLoadedOnce && decisions.hasLoadedOnce;
  const listIds = useMemo(
    () => [
      ...blocking.map((b) => b.id),
      ...improvements.map((c) => c.id),
      ...recentDecisions.map((d) => d.id),
    ],
    [blocking, improvements, recentDecisions],
  );

  useEffect(() => {
    if (!routeSelectedId) return;
    if (!listLoaded) return;
    if (listIds.includes(routeSelectedId)) return;
    goToList();
  }, [routeSelectedId, listIds, listLoaded, goToList]);

  useEffect(() => {
    if (routeSelectedId) return;
    if (!listLoaded) return;
    if (!isDesktop) return;
    const first = listIds[0];
    if (!first) return;
    select(first, true);
  }, [routeSelectedId, listLoaded, isDesktop, listIds, select]);

  const backAction = useMemo(() => {
    if (!routeSelectedId) return null;
    const title = selectedBlocking?.title ?? selectedCandidate?.title ?? selectedDecision?.title;
    return { label: t('backToList'), title, onBack: goToList };
  }, [routeSelectedId, selectedBlocking, selectedCandidate, selectedDecision, goToList, t]);
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

  const firstRunUndecided = setup.loading || (setup.isFirstRun && !listLoaded);
  if (firstRunUndecided) return null;
  const nothingToReview =
    blocking.length === 0 && improvements.length === 0 && recentDecisions.length === 0;
  if (setup.isFirstRun && nothingToReview) {
    return <ReviewFirstRun setup={setup} decidedCount={decisions.items.length} />;
  }

  const afterDecision = (ok: boolean) => {
    if (ok) void decisions.reload();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <section
        onScroll={onListScroll}
        className={cn(
          'flex min-h-0 flex-col border-r border-ink max-md:overflow-y-auto dark:border-rule-on-dark',
          routeSelectedId ? 'max-md:hidden' : '',
        )}
      >
        <header className="shrink-0 border-b border-rule-soft px-5 pb-4 pt-6 md:px-6 dark:border-rule-on-dark">
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

        <ul onScroll={onListScroll} className="pb-6 md:min-h-0 md:flex-1 md:overflow-y-auto">
          <ConsoleSectionLabel note={blocking.length > 0 ? t('sectionBlockingNote') : undefined}>
            {t('sectionBlocking', { count: blocking.length })}
          </ConsoleSectionLabel>
          {blocking.length === 0 ? (
            <EmptySection title={t('emptyBlockingTitle')} body={t('emptyBlockingBody')} />
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
            <EmptySection title={t('emptyImprovementsTitle')} body={t('emptyImprovementsBody')} />
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

          {recentDecisions.length > 0 ? (
            <>
              <ConsoleSectionLabel>
                {t('sectionDecided', { days: DECIDED_WINDOW_DAYS, count: recentDecisions.length })}
              </ConsoleSectionLabel>
              {recentDecisions.map((item) => (
                <ReviewDecidedRow
                  key={item.id}
                  item={item}
                  active={item.id === activeId}
                  faded
                  onSelect={() => select(item.id)}
                />
              ))}
            </>
          ) : null}
        </ul>
      </section>

      <div
        className={cn(
          'min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]',
          routeSelectedId ? 'grid' : 'hidden md:grid',
        )}
      >
        {!activeId ? (
          <section className="hidden min-h-0 flex-col items-start bg-paper-deep p-8 md:flex dark:bg-secondary">
            {listIds.length > 0 ? (
              <span className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-mute">
                {t('selectEmpty')}
              </span>
            ) : null}
          </section>
        ) : selectedBlocking ? (
          <ReviewBlockingPane
            item={selectedBlocking}
            controller={inbox}
            afterDecision={afterDecision}
          />
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

function EmptySection({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex flex-col gap-2 border-b border-rule-soft px-5 py-6 dark:border-rule-on-dark">
      <h3 className="font-serif text-lg font-normal leading-tight text-ink dark:text-foreground">
        {title}
      </h3>
      <p className="max-w-[48ch] text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">
        {body}
      </p>
    </li>
  );
}
