'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useRealtime } from '../realtime';
import { DashboardHero } from '../components/dashboard/dashboard-hero';
import { OverviewConversations } from '../components/dashboard/overview-conversations';
import { OverviewReview } from '../components/dashboard/overview-review';
import { UsageKpis, type UsageSummary } from '../components/dashboard/usage-kpis';
import { LoadFailed } from '../components/load-failed';
import { OverviewFirstRun, useSetupState } from '../components/first-run';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { useInboxData } from '../components/dashboard/inbox-data';

export function DashboardPage() {
  const inbox = useInboxData();
  const setup = useSetupState();
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

  if (setup.loading) return null;
  if (setup.isFirstRun) return <OverviewFirstRun setup={setup} />;

  return (
    <div className="mx-auto max-w-4xl space-y-12 px-4 pb-16 pt-11 md:px-10">
      <DashboardHero date={new Date()} />

      <OverviewConversations liveCount={inbox.items.length} />

      <OverviewReview queue={inbox.queue} scheduled={inbox.scheduled} />

      <UsageKpis summary={summary} />
    </div>
  );
}
