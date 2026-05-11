'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useActiveMembership } from '../auth/use-active-role';
import { useRealtime } from '../realtime';
import { DashboardHero } from '../components/dashboard/dashboard-hero';
import { GetStarted } from '../components/dashboard/get-started';
import { InboxPreview } from '../components/dashboard/inbox-preview';
import { UsageKpis, type UsageSummary } from '../components/dashboard/usage-kpis';
import {
  mergeInboxPreview,
  totalInboxCount,
  type InboxQueueShape,
} from '../lib/inbox-preview';

export function DashboardPage() {
  const [inbox, setInbox] = useState<InboxQueueShape | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const { membership } = useActiveMembership();
  const orgName = membership?.name ?? null;

  const loadInbox = useCallback(() => {
    void api<InboxQueueShape>('/api/v1/inbox')
      .then(setInbox)
      .catch(() => setInbox(null));
  }, []);
  const loadSummary = useCallback(() => {
    void api<UsageSummary>('/api/v1/usage/summary')
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    loadInbox();
    loadSummary();
  }, [loadInbox, loadSummary]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (
      event.type.startsWith('conversation.') ||
      event.type.startsWith('kb.document.') ||
      event.type.startsWith('kb.curation.') ||
      event.type.startsWith('crm.merge_proposal.') ||
      event.type.startsWith('outreach.')
    ) {
      loadInbox();
      loadSummary();
    }
  });

  const rows = mergeInboxPreview(inbox, 5);
  const totalCount = totalInboxCount(inbox);
  const liveCount = inbox?.live.length ?? 0;

  return (
    <div className="px-10 py-10 max-w-7xl mx-auto space-y-10">
      <DashboardHero
        orgName={orgName}
        date={new Date()}
        totalCount={totalCount}
        liveCount={liveCount}
      />

      {totalCount > 0 ? (
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
          <InboxPreview rows={rows} totalCount={totalCount} />
          <UsageKpis summary={summary} />
        </div>
      ) : (
        <UsageKpis summary={summary} />
      )}

      <GetStarted />
    </div>
  );
}
