'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useRealtime } from '../realtime';
import { DashboardHero } from '../components/dashboard/dashboard-hero';
import { GetStarted } from '../components/dashboard/get-started';
import { OverviewStats } from '../components/dashboard/overview-stats';
import { UsageKpis, type UsageSummary } from '../components/dashboard/usage-kpis';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import {
  useInboxData,
  QueueSection,
  ScheduledSection,
  InboxDrawers,
} from '../components/dashboard/inbox-sections';

export function DashboardPage() {
  const inbox = useInboxData();
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

  const learningCount = inbox.queue.filter((q) => q.kind === 'kb').length;

  return (
    <div className="mx-auto max-w-4xl space-y-12 px-4 pb-16 pt-11 md:px-10">
      <DashboardHero
        date={new Date()}
        liveCount={inbox.items.length}
        queueCount={inbox.queue.length}
      />

      <OverviewStats liveCount={inbox.items.length} learningCount={learningCount} />

      <QueueSection controller={inbox} />
      <ScheduledSection controller={inbox} />

      <UsageKpis summary={summary} />

      <GetStarted />

      <InboxDrawers controller={inbox} />
    </div>
  );
}
