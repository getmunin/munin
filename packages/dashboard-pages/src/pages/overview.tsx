'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useActiveMembership } from '../auth/use-active-role';
import { useRealtime } from '../realtime';
import { ConnectionBanner } from '../components/connection-banner';
import { DashboardHero } from '../components/dashboard/dashboard-hero';
import { GetStarted } from '../components/dashboard/get-started';
import { RecentConversationsSection } from '../components/dashboard/recent-conversations';
import { UsageKpis, type UsageSummary } from '../components/dashboard/usage-kpis';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import {
  useInboxData,
  LiveNowSection,
  QueueSection,
  InboxDrawers,
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
      <>
        <ConnectionBanner status={inbox.connectionStatus} />
        <div className="px-4 md:px-10 pt-11 pb-6 max-w-7xl mx-auto">
          <LoadFailed
            {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <ConnectionBanner status={inbox.connectionStatus} />
      <div className="px-4 md:px-10 pt-11 pb-6 max-w-7xl mx-auto space-y-9">
        <DashboardHero
        orgName={orgName}
        date={new Date()}
        liveCount={inbox.items.length}
        queueCount={inbox.queue.length}
      />

      <LiveNowSection controller={inbox} />
      <QueueSection controller={inbox} />

      <UsageKpis summary={summary} />

      <RecentConversationsSection controller={inbox} />

      <GetStarted />

      <InboxDrawers controller={inbox} />
      </div>
    </>
  );
}
