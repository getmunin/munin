'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { isOwnerOrAdmin, useActiveRole } from '../auth/use-active-role';
import { useRouter } from '../i18n-navigation';
import { useRealtime } from '../realtime';
import { DashboardHero } from '../components/dashboard/dashboard-hero';
import { OverviewStats } from '../components/dashboard/overview-stats';
import { GetStarted } from '../components/dashboard/get-started';
import { RecentConversationsSection } from '../components/dashboard/recent-conversations';
import { UsageKpis, type UsageSummary } from '../components/dashboard/usage-kpis';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import {
  useInboxData,
  LiveNowSection,
  QueueSection,
  ScheduledSection,
  InboxDrawers,
} from '../components/dashboard/inbox-sections';

export function DashboardPage() {
  const inbox = useInboxData();
  const router = useRouter();
  const { role, loading: roleLoading } = useActiveRole();
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

  useEffect(() => {
    if (!roleLoading && role !== null && !isOwnerOrAdmin(role)) {
      router.replace('/dashboard/conversations');
    }
  }, [roleLoading, role, router]);

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

  return (
    <>
      <div className="px-4 md:px-10 pt-11 pb-6 max-w-7xl mx-auto space-y-9">
        <DashboardHero
        date={new Date()}
        liveCount={inbox.items.length}
        queueCount={inbox.queue.length}
      />

      <OverviewStats
        liveCount={inbox.items.length}
        learningCount={inbox.queue.filter((q) => q.kind === 'kb').length}
        liveHref="/dashboard/conversations"
        learningHref="/dashboard/learning"
      />

      <LiveNowSection controller={inbox} />
      <QueueSection controller={inbox} />
      <ScheduledSection controller={inbox} />

      <UsageKpis summary={summary} />

      <RecentConversationsSection controller={inbox} />

      <GetStarted />

      <InboxDrawers controller={inbox} />
      </div>
    </>
  );
}
