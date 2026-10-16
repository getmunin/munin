'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageSpinner,
  cn,
} from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { BroadcastEmailPreview } from './broadcast-email-preview';
import type {
  BroadcastDetailDto,
  BroadcastStatus,
  BroadcastSummaryDto,
} from './queue-panes/types';

const LIVE_STATUSES: readonly BroadcastStatus[] = ['approved', 'sending'];
const HATCH =
  'bg-[repeating-linear-gradient(135deg,currentColor_0_1.5px,transparent_1.5px_4.5px)] text-ink-mute';
const STARTED_STATUSES: readonly BroadcastStatus[] = ['sending', 'sent', 'failed'];
const REFRESH_MS = 15_000;

export function BroadcastDecidedContent({
  broadcast,
  onChanged,
}: {
  broadcast: BroadcastSummaryDto;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('dashboard.console.review.decidedContent');
  const format = useFormatter();
  const translateErr = useTranslateError();
  const [detail, setDetail] = useState<BroadcastDetailDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api<BroadcastDetailDto>(`/v1/outreach/broadcasts/${broadcast.id}`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [broadcast.id]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  const status = detail?.status ?? broadcast.status;
  const live = LIVE_STATUSES.includes(status);
  const started = Boolean(detail?.startedAt) || STARTED_STATUSES.includes(status);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const cancel = useCallback(async () => {
    const reason = cancelReason.trim();
    if (!reason) return;
    setPending(true);
    try {
      setDetail(
        await api<BroadcastDetailDto>(`/v1/outreach/broadcasts/${broadcast.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }),
      );
      setCancelOpen(false);
      setCancelReason('');
      await onChanged();
    } catch (err) {
      notify.error(translateErr(err));
    } finally {
      setPending(false);
    }
  }, [broadcast.id, cancelReason, onChanged, translateErr]);

  const counts = detail?.counts ?? broadcast.counts;
  const total = Math.max(
    broadcast.approvedAudienceCount ?? 0,
    counts.sent + counts.queued + counts.skipped + counts.failed,
  );
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const sentRatio = total > 0 ? counts.sent / total : 0;
  const segments: { key: string; label: string; value: number; swatch: string }[] = [
    { key: 'sent', label: t('broadcastSent'), value: counts.sent, swatch: 'bg-cobalt dark:bg-cobalt-soft' },
    { key: 'queued', label: t('broadcastQueued'), value: counts.queued, swatch: 'bg-transparent ring-1 ring-inset ring-ink-mute' },
    { key: 'skipped', label: t('broadcastSkipped'), value: counts.skipped, swatch: HATCH },
    { key: 'failed', label: t('broadcastFailed'), value: counts.failed, swatch: 'bg-alert-bad-border' },
  ];
  const outcomes: [string, number][] = [
    [t('broadcastReplied'), counts.replied],
    [t('broadcastUnsubscribed'), counts.unsubscribed],
    [t('broadcastBounced'), counts.bounced],
  ];
  const when = (iso: string | null | undefined) =>
    iso
      ? format.dateTime(new Date(iso), {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
  const timing = [
    status === 'approved' && when(detail?.scheduledSendAt ?? broadcast.scheduledSendAt)
      ? t('broadcastStarts', { when: when(detail?.scheduledSendAt ?? broadcast.scheduledSendAt)! })
      : null,
    when(detail?.startedAt) ? t('broadcastStarted', { when: when(detail?.startedAt)! }) : null,
    when(detail?.completedAt) ? t('broadcastFinished', { when: when(detail?.completedAt)! }) : null,
  ].filter((line): line is string => line !== null);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-soft pb-2.5 dark:border-rule-on-dark">
        <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
          {t('broadcastLabel')}
        </span>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-meta',
              live ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full',
                live ? 'bg-cobalt dark:bg-cobalt-soft' : 'bg-ink-mute',
                status === 'sending' && 'animate-pulse',
              )}
            />
            {t(`broadcastStatus.${status}`)}
          </span>
          {live ? (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setCancelOpen(true)}>
              {t('broadcastStop')}
            </Button>
          ) : null}
        </div>
      </div>

      {started ? (
      <>
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <p className="flex items-baseline gap-2 text-ink dark:text-foreground">
            <span className="font-serif text-[44px] leading-none tabular-nums tracking-tight">
              {counts.sent}
            </span>
            <span className="text-[15px] text-ink-soft dark:text-foreground/70">
              {t('broadcastOfTotal', { total })}
            </span>
          </p>
          <span className="pb-1 font-mono text-[12px] tabular-nums text-ink-soft dark:text-foreground/70">
            {format.number(sentRatio, { style: 'percent', maximumFractionDigits: 0 })}
          </span>
        </div>

        <div
          role="img"
          aria-label={t('broadcastProgressLabel', { sent: counts.sent, total })}
          className="flex h-2.5 w-full overflow-hidden bg-paper-deep ring-1 ring-inset ring-rule-soft dark:bg-secondary dark:ring-rule-on-dark"
        >
          {segments
            .filter((segment) => segment.key !== 'queued' && segment.value > 0)
            .map((segment) => (
              <span
                key={segment.key}
                className={cn('h-full transition-[width] duration-700 ease-out', segment.swatch)}
                style={{ width: `${share(segment.value)}%` }}
              />
            ))}
        </div>

        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {segments.map((segment) => (
            <li
              key={segment.key}
              className={cn(
                'inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-meta',
                segment.value > 0 ? 'text-ink-soft dark:text-foreground/70' : 'text-ink-mute opacity-70',
              )}
            >
              <span aria-hidden className={cn('size-2 shrink-0', segment.swatch)} />
              {segment.label}
              <span className="tabular-nums text-ink dark:text-foreground">{segment.value}</span>
            </li>
          ))}
        </ul>

        {timing.length > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-ink-mute">
            {timing.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-3 divide-x divide-rule-soft border-y border-rule-soft dark:divide-rule-on-dark dark:border-rule-on-dark">
        {outcomes.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1.5 px-4 py-3.5 first:pl-0">
            <dt className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
              {label}
            </dt>
            <dd className="flex items-baseline gap-2">
              <span className="font-serif text-[28px] leading-none tabular-nums text-ink dark:text-foreground">
                {value}
              </span>
              {counts.sent > 0 ? (
                <span className="font-mono text-[10.5px] tabular-nums text-ink-mute">
                  {t('broadcastRateOfSent', {
                    rate: format.number(value / counts.sent, {
                      style: 'percent',
                      maximumFractionDigits: 1,
                    }),
                  })}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-[12.5px] leading-snug text-ink-mute">{t('broadcastRecipientsHint')}</p>
      </>
      ) : null}

      {detail?.preview.html ? (
        <BroadcastEmailPreview
          html={detail.preview.html}
          text={detail.preview.text}
          recipientName={detail.preview.recipient.name ?? detail.preview.recipient.address}
        />
      ) : failed ? (
        <p className="text-[13px] text-ink-mute">{t('broadcastUnavailable')}</p>
      ) : detail ? null : (
        <div className="flex min-h-[120px] items-center justify-center">
          <PageSpinner />
        </div>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('broadcastStopTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-[13.5px] leading-relaxed text-ink-soft dark:text-foreground/70">
            {t('broadcastStopBody', { sent: counts.sent })}
          </p>
          <Input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t('broadcastStopReason')}
            maxLength={500}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              {t('broadcastStopKeep')}
            </Button>
            <Button
              variant="accent"
              disabled={pending || !cancelReason.trim()}
              onClick={() => void cancel()}
            >
              {t('broadcastStop')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
