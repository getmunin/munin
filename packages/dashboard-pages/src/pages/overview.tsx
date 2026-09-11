'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../api';
import { useRealtime } from '../realtime';
import { DashboardHero } from '../components/dashboard/dashboard-hero';
import { OverviewConversations } from '../components/dashboard/overview-conversations';
import { OverviewReview } from '../components/dashboard/overview-review';
import { UsageKpis, type UsageSummary } from '../components/dashboard/usage-kpis';
import { LoadFailed } from '../components/load-failed';
import { Skeleton } from '../components/skeleton';
import { OverviewFirstRun, useFirstRunGate } from '../components/first-run';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { useInboxData } from '../components/dashboard/inbox-data';

const OVERVIEW_SHELL = 'mx-auto max-w-4xl space-y-12 px-4 pb-16 pt-11 md:px-10';

export function DashboardPage() {
  const inbox = useInboxData();
  const gate = useFirstRunGate({ content: inbox.hasLoadedOnce });
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const buildLoadFailedProps = useInboxLoadFailedProps();

  const loadSummary = useCallback(() => {
    void api<UsageSummary>('/v1/usage/summary')
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (
      event.type.startsWith('conversation.') ||
      event.type.startsWith('kb.') ||
      event.type.startsWith('crm.') ||
      event.type.startsWith('outreach.')
    ) {
      loadSummary();
    }
  });

  if (inbox.loadError && !inbox.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 md:px-10 py-12">
        <LoadFailed
          {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
        />
      </div>
    );
  }

  if (gate.view === 'loading') return <OverviewSkeleton />;
  if (gate.view === 'firstRun') return <OverviewFirstRun setup={gate.setup} />;

  return (
    <div className={OVERVIEW_SHELL}>
      <DashboardHero date={new Date()} />

      <OverviewConversations liveCount={inbox.itemsTotal} />

      <OverviewReview queue={inbox.queue} scheduled={inbox.scheduled} />

      <UsageKpis summary={summary} />
    </div>
  );
}

function OverviewSkeleton() {
  const t = useTranslations('common');

  return (
    <div role="status" aria-busy="true" className={OVERVIEW_SHELL}>
      <span className="sr-only">{t('loading')}</span>
      <header aria-hidden className="space-y-3 pb-8">
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="h-11 w-2/3 md:h-14" />
        <Skeleton className="h-4 w-1/2" />
      </header>
      {[0, 1].map((section) => (
        <section
          key={section}
          aria-hidden
          className="border-t border-t-ink dark:border-t-rule-on-dark"
        >
          <div className="flex items-center gap-3.5 px-5 py-4 md:gap-5 md:py-5">
            <Skeleton className="size-2 shrink-0 rounded-full" />
            <Skeleton className="h-8 w-11 shrink-0 md:h-11 md:w-14" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-2 w-24" />
              <Skeleton className="h-3.5 w-2/5" />
            </span>
          </div>
          <div className="border-t border-rule-soft dark:border-rule-on-dark">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex items-center gap-3.5 border-b border-rule-soft px-5 py-3.5 dark:border-rule-on-dark"
              >
                <Skeleton className="h-4 w-11 shrink-0" />
                <Skeleton className="h-3.5 w-2/5" />
              </div>
            ))}
          </div>
        </section>
      ))}
      <section aria-hidden className="min-w-0">
        <div className="mb-3.5 border-b border-rule-soft pb-2.5 dark:border-rule-on-dark">
          <Skeleton className="h-2.5 w-28" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3.5">
          {[0, 1, 2, 3, 4].map((tile) => (
            <div key={tile} className="space-y-2">
              <Skeleton className="h-2 w-16" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
