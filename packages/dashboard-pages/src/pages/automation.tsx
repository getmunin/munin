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
import { api } from '../api';
import { EmptyCallout } from '../components/empty-callout';
import { notify } from '../lib/notify';
import { useTranslateError } from '../i18n/translate-error';
import { CardListSkeleton } from '../components/skeleton';

type AgentMode = 'auto' | 'draft_only' | 'off';
type AutomationHold = 'sample' | 'unedited' | 'rejected' | null;

interface TopicAutomationRow {
  topicId: string;
  name: string;
  slug: string;
  agentMode: AgentMode | null;
  autoPromotedAt: string | null;
  windowDays: number;
  reviewed: number;
  autoSent: number;
  unedited: number;
  edited: number;
  rejected: number;
  uneditedPct: number;
  editedPct: number;
  rejectedPct: number;
  hold: AutomationHold;
  ready: boolean;
}

interface TopicAutomationOverview {
  windowDays: number;
  minSample: number;
  minUneditedRate: number;
  maxRejectedRate: number;
  autoSendRatePct: number;
  reviewed: number;
  autoSent: number;
  topics: TopicAutomationRow[];
}

export function AutomationPage() {
  const t = useTranslations('dashboard.automation');
  const tCommon = useTranslations('common');
  const translateErr = useTranslateError();

  const [overview, setOverview] = useState<TopicAutomationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [promoting, setPromoting] = useState<TopicAutomationRow | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await api<TopicAutomationOverview>('/v1/conversations/automation'));
    } catch (err) {
      notify.error(translateErr(err));
    } finally {
      setLoading(false);
    }
  }, [translateErr]);

  useEffect(() => {
    void load();
  }, [load]);

  const setMode = async (topicId: string, mode: AgentMode | null) => {
    setPending(true);
    try {
      await api(`/v1/conversations/topics/${topicId}/automation`, {
        method: 'POST',
        body: JSON.stringify({ agentMode: mode }),
      });
      setPromoting(null);
      await load();
    } catch (err) {
      notify.error(translateErr(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-10 md:py-11">
      <header>
        <p className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:text-foreground/55">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 font-serif text-[38px] font-normal leading-[1.02] tracking-tight text-ink md:text-[48px] dark:text-foreground">
          {t.rich('title', { em: (chunks) => <em className="italic text-cobalt">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-ink-soft [text-wrap:pretty] dark:text-foreground/75">
          {t('lede')}
        </p>
      </header>

      {overview ? (
        <div className="mt-8 flex items-baseline gap-4 border-y-[1px] border-rule-soft py-5 dark:border-rule-on-dark">
          <span className="font-serif text-[44px] leading-none text-ink dark:text-foreground">
            {overview.autoSendRatePct}%
          </span>
          <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
            {t('autoRateNote', { days: overview.windowDays })}
          </span>
        </div>
      ) : null}

      <section className="mt-9">
        <div className="hidden items-baseline gap-4 border-b-[1px] border-ink pb-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink sm:flex dark:border-rule-on-dark dark:text-foreground">
          <span className="flex-1">{t('colTopic')}</span>
          <span className="w-28 text-right">{t('colVolume')}</span>
          <span className="w-32 text-right">{t('colUnedited')}</span>
          <span className="w-40 text-right">{t('colState')}</span>
        </div>

        {loading ? (
          <div className="pt-6">
            <CardListSkeleton rows={3} />
          </div>
        ) : overview && overview.topics.length > 0 ? (
          <ul>
            {overview.topics.map((row) => (
              <li
                key={row.topicId}
                className="flex flex-col gap-2 border-b-[1px] border-rule-soft py-4 sm:flex-row sm:items-center sm:gap-4 dark:border-rule-on-dark"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-ink dark:text-foreground">{row.name}</p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
                    {row.hold ? t(`hold.${row.hold}`) : t('holdNone')}
                  </p>
                </div>

                <div className="flex items-baseline gap-4 sm:contents">
                  <span className="font-mono text-[11px] text-ink sm:w-28 sm:text-right dark:text-foreground">
                    {row.reviewed}
                    <span className="ml-1 text-ink-mute">
                      {t('lastDays', { days: row.windowDays })}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-ink sm:w-32 sm:text-right dark:text-foreground">
                    {row.reviewed === 0 ? '—' : `${row.uneditedPct}%`}
                  </span>
                </div>

                <div className="sm:w-40 sm:text-right">
                  {row.agentMode === 'auto' ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-cobalt dark:bg-cobalt-soft"
                      />
                      <span className="font-mono text-[9px] uppercase tracking-meta text-cobalt dark:text-cobalt-soft">
                        {t('stateAuto')}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setMode(row.topicId, 'draft_only')}
                        disabled={pending}
                      >
                        {t('demote')}
                      </Button>
                    </span>
                  ) : row.ready ? (
                    <Button
                      size="sm"
                      variant="accent"
                      className="max-sm:min-h-11 max-sm:w-full"
                      onClick={() => setPromoting(row)}
                      disabled={pending}
                    >
                      {t('promote')}
                    </Button>
                  ) : (
                    <span
                      className={cn(
                        'font-mono text-[9px] uppercase tracking-meta',
                        row.hold === 'rejected'
                          ? 'text-ink dark:text-foreground'
                          : 'text-ink-mute dark:text-foreground/55',
                      )}
                    >
                      {t('stateManual')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="pt-6">
            <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
          </div>
        )}
      </section>

      <p className="mt-10 max-w-[56ch] font-serif text-[22px] italic leading-snug text-ink dark:text-foreground">
        {t.rich('closing', {
          em: (chunks) => <span className="text-cobalt dark:text-cobalt-soft">{chunks}</span>,
        })}
      </p>

      <Dialog open={promoting !== null} onOpenChange={(o) => !o && setPromoting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('promoteTitle', { topic: promoting?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('promoteDescription')}</DialogDescription>
          </DialogHeader>
          {promoting ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Stat label={t('colUnedited')} value={`${promoting.uneditedPct}%`} accent />
                <Stat label={t('statEdited')} value={`${promoting.editedPct}%`} />
                <Stat label={t('statRejected')} value={`${promoting.rejectedPct}%`} />
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-ink-soft dark:text-foreground/75">
                {t('promoteExplain', {
                  count: promoting.reviewed,
                  days: promoting.windowDays,
                })}
              </p>
            </>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoting(null)} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={() => promoting && void setMode(promoting.topicId, 'auto')}
              disabled={pending}
              pending={pending}
            >
              {t('promoteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border-[1px] border-rule-soft px-3 py-2.5 dark:border-rule-on-dark">
      <p
        className={cn(
          'font-serif text-[26px] leading-none',
          accent ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink dark:text-foreground',
        )}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[8px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
        {label}
      </p>
    </div>
  );
}
