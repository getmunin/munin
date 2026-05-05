'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Bot, Mail, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTrigger,
} from '@getmunin/ui';
import { CrmMergeProposalsPage } from './crm-merge-proposals';
import { KbCandidatesTab } from './kb-candidates';
import { OutreachDraftsTab } from './outreach-drafts';
import { api, ApiError } from '../api';
import { useRealtime } from '../realtime';

const POLL_MS = 60_000;

interface CountState {
  kb: number;
  crm: number;
  outreach: number;
}

export function ReviewPage() {
  const t = useTranslations('dashboard.review');
  const [counts, setCounts] = useState<CountState>({ kb: 0, crm: 0, outreach: 0 });

  const loadCounts = useCallback(async () => {
    try {
      const [kbRes, crmRes, outreachRes] = await Promise.all([
        api<{ items: unknown[] }>('/api/kb/curation/candidates').catch(() => ({ items: [] })),
        api<{ items: unknown[] }>('/api/crm/merge-proposals?status=pending&limit=200').catch(
          () => ({ items: [] }),
        ),
        api<{ items: unknown[] }>('/api/outreach/proposals?status=pending&limit=200').catch(
          () => ({ items: [] }),
        ),
      ]);
      setCounts({
        kb: kbRes.items.length,
        crm: crmRes.items.length,
        outreach: outreachRes.items.length,
      });
    } catch (err) {
      if (err instanceof ApiError) return;
      throw err;
    }
  }, []);

  useEffect(() => {
    void loadCounts();
    const id = setInterval(() => void loadCounts(), POLL_MS);
    return () => clearInterval(id);
  }, [loadCounts]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (
      event.type.startsWith('kb.') ||
      event.type.startsWith('crm.merge_proposal.') ||
      event.type.startsWith('outreach.proposal.')
    ) {
      void loadCounts();
    }
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="text-sm text-muted-foreground">
          {t.rich('automateHint', {
            adminAgent: (chunks) => (
              <Link
                href="/dashboard/settings/agents"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <Bot className="size-3.5" />
                {chunks}
              </Link>
            ),
          })}
        </p>
      </header>

      <Tabs defaultValue="kb">
        <TabsList>
          <TabsTrigger value="kb" className="gap-2">
            <Bookmark className="size-4" />
            {t('tabs.kb')}
            {counts.kb > 0 && <Badge variant="secondary">{counts.kb}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="crm" className="gap-2">
            <Users className="size-4" />
            {t('tabs.crm')}
            {counts.crm > 0 && <Badge variant="secondary">{counts.crm}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="outreach" className="gap-2">
            <Mail className="size-4" />
            {t('tabs.outreach')}
            {counts.outreach > 0 && <Badge variant="secondary">{counts.outreach}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsPanel value="kb">
          <KbCandidatesTab onCountChange={(n) => setCounts((c) => ({ ...c, kb: n }))} />
        </TabsPanel>
        <TabsPanel value="crm">
          <CrmMergeProposalsPage />
        </TabsPanel>
        <TabsPanel value="outreach">
          <OutreachDraftsTab onCountChange={(n) => setCounts((c) => ({ ...c, outreach: n }))} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
