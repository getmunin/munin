'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Bot, CheckCircle2, Code2, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';
import { api } from '../api';

interface BacklogDto {
  conversationsNeedingAttention: number;
  kbCurationPending: number;
  crmMergeProposalsPending: number;
}

export function DashboardPage() {
  const t = useTranslations('dashboard.overview');
  const tBacklog = useTranslations('dashboard.needsAttention');

  const [backlog, setBacklog] = useState<BacklogDto | null>(null);

  useEffect(() => {
    void api<BacklogDto>('/api/overview/backlog')
      .then(setBacklog)
      .catch(() => setBacklog(null));
  }, []);

  const allClear =
    backlog !== null &&
    backlog.conversationsNeedingAttention === 0 &&
    backlog.kbCurationPending === 0 &&
    backlog.crmMergeProposalsPending === 0;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {backlog !== null && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {allClear ? (
                <CheckCircle2 className="size-5 text-muted-foreground" />
              ) : (
                <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />
              )}
              <CardTitle>{tBacklog('title')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {allClear ? (
              <p className="text-muted-foreground">{tBacklog('allClear')}</p>
            ) : (
              <ul className="space-y-2">
                {backlog.conversationsNeedingAttention > 0 && (
                  <li className="flex items-center justify-between gap-3">
                    <span>
                      <strong className="font-medium">
                        {backlog.conversationsNeedingAttention}
                      </strong>{' '}
                      {tBacklog('conversationsLabel')}
                    </span>
                    <Link
                      href="/dashboard/conversations"
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {tBacklog('openConversations')}
                    </Link>
                  </li>
                )}
                {backlog.kbCurationPending > 0 && (
                  <li>
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <strong className="font-medium">{backlog.kbCurationPending}</strong>{' '}
                        {tBacklog('kbCurationLabel')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tBacklog('kbCurationHint')}
                    </p>
                  </li>
                )}
                {backlog.crmMergeProposalsPending > 0 && (
                  <li className="flex items-center justify-between gap-3">
                    <span>
                      <strong className="font-medium">{backlog.crmMergeProposalsPending}</strong>{' '}
                      {tBacklog('crmMergeProposalsLabel')}
                    </span>
                    <Link
                      href="/dashboard/crm-merge-proposals"
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {tBacklog('openMergeProposals')}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-muted-foreground" />
              <CardTitle>{t('connectCard.title')}</CardTitle>
            </div>
            <CardDescription>{t('connectCard.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              https://mcp.getmunin.com
            </code>
            <p className="text-xs text-muted-foreground">{t('connectCard.consentNote')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Code2 className="size-5 text-muted-foreground" />
              <CardTitle>{t('buildCard.title')}</CardTitle>
            </div>
            <CardDescription>{t('buildCard.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" render={<Link href="/dashboard/settings/api-keys" />}>
              <KeyRound className="size-4" />
              {t('buildCard.cta')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
