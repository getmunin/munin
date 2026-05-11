'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useActiveMembership } from '../auth/use-active-role';
import { useRealtime } from '../realtime';
import { DashboardHero } from '../components/dashboard/dashboard-hero';
import { GetStarted } from '../components/dashboard/get-started';
import { UsageKpis, type UsageSummary } from '../components/dashboard/usage-kpis';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import {
  useInboxData,
  LiveNowSection,
  QueueSection,
  InboxDrawers,
  InboxErrorBanner,
} from '../components/dashboard/inbox-sections';

export function DashboardPage() {
  const inbox = useInboxData();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const { membership } = useActiveMembership();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const orgName = membership?.name ?? null;

  const loadSummary = useCallback(() => {
    void api<UsageSummary>('/api/v1/usage/summary')
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
      <div className="px-10 py-10 max-w-7xl mx-auto">
        <LoadFailed
          {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
        />
      </div>
    );
  }

  return (
    <div className="px-10 py-10 max-w-7xl mx-auto space-y-10">
      <DashboardHero
        orgName={orgName}
        date={new Date()}
        liveCount={inbox.items.length}
        queueCount={inbox.queue.length}
      />

      {inbox.error && <InboxErrorBanner message={inbox.error} />}

      <LiveNowSection controller={inbox} />
      <QueueSection controller={inbox} />

      <UsageKpis summary={summary} />

      <GetStarted />

      <InboxDrawers controller={inbox} />
    </div>
  );
}
