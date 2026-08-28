'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@getmunin/ui';
import { api, ApiError } from '../api';
import { notify } from '../lib/notify';
import { useTranslateError } from '../i18n/translate-error';
import { useRealtime } from '../realtime';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';

type TopicMode = 'auto' | 'draft_only' | 'off' | null;

interface TopicAutomationRow {
  id: string;
  name: string;
  slug: string;
  agentMode: TopicMode;
  autoPromotedAt: string | null;
  windowDays: number;
  weeklyVolume: number;
  reviewedCount: number;
  approvedUnedited: number;
  edited: number;
  rejected: number;
  autoSent: number;
}

interface AutomationSummary {
  windowDays: number;
  autoRate7d: number | null;
  topics: TopicAutomationRow[];
}

const READY_THRESHOLD = 0.9;

function uneditedShare(row: TopicAutomationRow): number | null {
  if (row.reviewedCount === 0) return null;
  return row.approvedUnedited / row.reviewedCount;
}

function isReady(row: TopicAutomationRow): boolean {
  const share = uneditedShare(row);
  return row.agentMode !== 'auto' && row.agentMode !== 'off' && share !== null && share >= READY_THRESHOLD;
}

export function AutomationPage() {
  const t = useTranslations('dashboard.console.automation');
  const translateErr = useTranslateError();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const [summary, setSummary] = useState<AutomationSummary | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [pending, setPending] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<TopicAutomationRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<AutomationSummary>('/v1/conversations/automation');
      setSummary(res);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (event.type.startsWith('conversation.')) void load();
  });

  const setMode = useCallback(
    async (row: TopicAutomationRow, mode: TopicMode) => {
      setPending(true);
      try {
        await api(`/v1/conversations/topics/${row.id}/agent-mode`, {
          method: 'POST',
          body: JSON.stringify({ mode }),
        });
        setPromoteTarget(null);
        await load();
        notify.success(
          mode === 'auto' ? t('promoted', { name: row.name }) : t('demoted', { name: row.name }),
        );
      } catch (err) {
        notify.error(translateErr(err));
      } finally {
        setPending(false);
      }
    },
    [load, t, translateErr],
  );

  if (loadError && !summary) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(
            loadError,
            () => {
              setRetrying(true);
              void load().finally(() => setRetrying(false));
            },
            retrying,
          )}
        />
      </div>
    );
  }

  const topics = summary?.topics ?? [];
  const autoRate = summary?.autoRate7d;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-col justify-between gap-6 border-b border-ink px-5 pb-5 pt-8 md:flex-row md:items-end md:px-8 dark:border-rule-on-dark">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {t('eyebrow')}
          </div>
          <h1 className="mt-1.5 font-serif text-4xl font-normal leading-tight tracking-tight text-ink dark:text-foreground">
            {t.rich('title', {
              em: (chunks) => <em className="italic text-cobalt dark:text-cobalt-soft">{chunks}</em>,
            })}
          </h1>
          <p className="mt-2.5 max-w-[52ch] text-sm leading-relaxed text-ink-soft dark:text-foreground/80">
            {t('lede')}
          </p>
        </div>
        <div className="shrink-0 md:text-right">
          <div className="font-serif text-6xl leading-none text-ink md:text-7xl dark:text-foreground">
            {autoRate === null || autoRate === undefined ? '—' : `${Math.round(autoRate * 100)}%`}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('autoRateCaption')}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-x-auto px-5 pb-10 md:px-8">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(170px,1.3fr)_110px_minmax(140px,1fr)_auto] items-center gap-4 border-b border-ink py-3.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:border-rule-on-dark">
            <span>{t('colTopic')}</span>
            <span>{t('colVolume')}</span>
            <span>{t('colUnedited')}</span>
            <span />
          </div>
          {topics.length === 0 ? (
            <p className="py-6 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
              {t('empty')}
            </p>
          ) : null}
          {topics.map((row) => {
            const share = uneditedShare(row);
            const pct = share === null ? null : Math.round(share * 100);
            const ready = isReady(row);
            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(170px,1.3fr)_110px_minmax(140px,1fr)_auto] items-center gap-4 border-b border-rule-soft py-4 dark:border-rule-on-dark"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-ink dark:text-foreground">
                    {row.name}
                  </span>
                  <span className="truncate font-mono text-[9px] uppercase tracking-meta text-ink-mute">
                    {row.agentMode === 'off'
                      ? t('subPolicy')
                      : row.autoPromotedAt
                        ? t('subPromoted', {
                            date: new Date(row.autoPromotedAt).toLocaleDateString(),
                          })
                        : ' '}
                  </span>
                </span>
                <span className="flex flex-col gap-0.5 whitespace-nowrap font-mono text-[11px] text-ink-soft dark:text-foreground/80">
                  <span>{t('volumePerWeek', { count: row.weeklyVolume })}</span>
                  <span className="text-ink-mute">{t('lastN', { count: row.reviewedCount })}</span>
                </span>
                <span className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'min-w-[52px] font-serif text-xl italic',
                      pct !== null && pct >= 90
                        ? 'text-cobalt dark:text-cobalt-soft'
                        : 'text-ink-soft dark:text-foreground/80',
                    )}
                  >
                    {pct === null ? '—' : `${pct}%`}
                  </span>
                  <span className="relative h-1 max-w-[120px] flex-1 bg-rule-soft dark:bg-rule-on-dark">
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0',
                        pct !== null && pct >= 90
                          ? 'bg-cobalt dark:bg-cobalt-soft'
                          : 'bg-ink-soft dark:bg-foreground/60',
                      )}
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </span>
                </span>
                <span className="flex min-w-[170px] items-center justify-end gap-2.5">
                  {row.agentMode === 'auto' ? (
                    <>
                      <span className="font-mono text-[9px] uppercase tracking-meta text-cobalt dark:text-cobalt-soft">
                        {t('autoOn')}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => void setMode(row, 'draft_only')}
                      >
                        {t('demote')}
                      </Button>
                    </>
                  ) : ready ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-cobalt text-cobalt hover:bg-cobalt hover:text-paper dark:border-cobalt-soft dark:text-cobalt-soft"
                      disabled={pending}
                      onClick={() => setPromoteTarget(row)}
                    >
                      {t('promote')} <span aria-hidden>→</span>
                    </Button>
                  ) : (
                    <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute">
                      {row.agentMode === 'off' ? t('holdPolicy') : t('holdThreshold')}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          <p className="mt-7 max-w-[56ch] font-serif text-xl italic leading-snug text-ink dark:text-foreground">
            {t.rich('footnote', {
              em: (chunks) => <span className="text-cobalt dark:text-cobalt-soft">{chunks}</span>,
            })}
          </p>
        </div>
      </div>

      <Dialog
        open={promoteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setPromoteTarget(null);
        }}
      >
        <DialogContent>
          {promoteTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('dialogTitle', { name: promoteTarget.name })}</DialogTitle>
                <DialogDescription>
                  {t('dialogLevels')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3 border-y border-rule-soft py-3.5 dark:border-rule-on-dark">
                {(
                  [
                    ['approvedUnedited', t('statUnedited')],
                    ['edited', t('statEdited')],
                    ['rejected', t('statRejected')],
                  ] as const
                ).map(([key, label]) => {
                  const total = promoteTarget.reviewedCount;
                  const pct = total > 0 ? Math.round((promoteTarget[key] / total) * 100) : 0;
                  return (
                    <div key={key}>
                      <div className="font-serif text-2xl text-ink dark:text-foreground">{pct}%</div>
                      <div className="mt-1 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
                        {label}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">
                {t('dialogExplain', { count: promoteTarget.reviewedCount })}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPromoteTarget(null)}>
                  {t('dialogNotYet')}
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  disabled={pending}
                  pending={pending}
                  onClick={() => void setMode(promoteTarget, 'auto')}
                >
                  {t('dialogPromote')} <span aria-hidden>→</span>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
