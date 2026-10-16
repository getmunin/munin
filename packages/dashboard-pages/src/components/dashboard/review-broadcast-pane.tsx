'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, PageSpinner, cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { ModulePill, toDateTimeLocalValue, useCmdEnter } from './queue-panes/shared';
import {
  BROADCAST_EXCLUSION_REASONS,
  type BroadcastDetailDto,
  type BroadcastSummaryDto,
} from './queue-panes/types';
import type { QueueActionError } from './inbox-types';
import { QueueActionErrorBanner } from './queue-action-error';
import { MoreActionsSheet, MoreActionsTrigger } from './pane-more-actions';
import { PaneNotice } from './pane-notice';
import { BroadcastEmailPreview } from './broadcast-email-preview';

export type BroadcastQueueItem = {
  id: string;
  title: string;
  snippet: string;
  createdAt: string;
  raw: BroadcastSummaryDto;
};

type SendChoice = 'scheduled' | 'now' | 'pick';

export function ReviewBroadcastPane({
  item,
  detail,
  loadError,
  pending,
  actionError,
  onClearActionError,
  onRetry,
  onReload,
  onApprove,
  onDismiss,
  onSendTest,
}: {
  item: BroadcastQueueItem;
  detail: BroadcastDetailDto | undefined;
  loadError: string | undefined;
  pending: boolean;
  actionError: QueueActionError;
  onClearActionError: () => void;
  onRetry: () => void;
  onReload: () => void;
  onApprove: (sendAt?: string | null) => void;
  onDismiss: () => void;
  onSendTest: () => Promise<string | null>;
}) {
  const t = useTranslations('dashboard.console.review.broadcast');
  const age = useRelative();
  const format = useFormatter();
  const [choice, setChoice] = useState<SendChoice>('now');
  const [pickedAt, setPickedAt] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [testState, setTestState] = useState<{ sending: boolean; sentTo: string | null }>({
    sending: false,
    sentTo: null,
  });

  const scheduledAt = useMemo(() => futureDate(detail?.scheduledSendAt), [detail?.scheduledSendAt]);

  useEffect(() => {
    setChoice(futureDate(item.raw.scheduledSendAt) ? 'scheduled' : 'now');
    setPickedAt('');
    setTestState({ sending: false, sentTo: null });
  }, [item.id, item.raw.scheduledSendAt]);

  const stamp = (d: Date) =>
    format.dateTime(d, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const eligible = detail?.audience.eligible ?? 0;
  const pickInvalid =
    choice === 'pick' &&
    (!pickedAt || Number.isNaN(new Date(pickedAt).getTime()) || new Date(pickedAt) <= new Date());
  const canApprove = Boolean(detail) && eligible > 0 && !pending && !pickInvalid;

  const approve = useCallback(() => {
    if (!canApprove) return;
    if (choice === 'scheduled') {
      onApprove(scheduledAt ? scheduledAt.toISOString() : undefined);
      return;
    }
    if (choice === 'now') {
      onApprove(null);
      return;
    }
    onApprove(new Date(pickedAt).toISOString());
  }, [canApprove, choice, scheduledAt, pickedAt, onApprove]);

  useCmdEnter(() => approve());

  const sendTest = useCallback(async () => {
    setTestState({ sending: true, sentTo: null });
    const to = await onSendTest();
    setTestState({ sending: false, sentTo: to });
  }, [onSendTest]);

  const changed =
    actionError?.itemId === item.id && actionError.code === 'outreach_broadcast_changed';
  const leftOut = detail
    ? BROADCAST_EXCLUSION_REASONS.reduce((sum, reason) => sum + detail.audience.excluded[reason], 0)
    : 0;

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-paper dark:bg-background">
      <div className="flex flex-1 flex-col gap-5 px-5 pb-8 pt-6 md:px-7">
        <header className="flex flex-col gap-2.5 max-md:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <ModulePill kind="broadcast">{t('eyebrow')}</ModulePill>
            <span className="ml-auto font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
              {item.raw.name} · {age(item.createdAt)}
            </span>
          </div>
          <h2 className="font-serif text-[26px] font-normal leading-[1.1] tracking-tight text-ink md:text-[29px] dark:text-foreground">
            {item.raw.subject}
          </h2>
          {detail?.preheader ? (
            <span className="text-[13.5px] text-ink-soft dark:text-foreground/70">
              {detail.preheader}
            </span>
          ) : null}
        </header>

        {!detail ? (
          loadError ? (
            <PaneNotice
              eyebrow={t('loadFailed')}
              action={
                <Button variant="outline" size="sm" onClick={onRetry}>
                  {t('retry')}
                </Button>
              }
            >
              {loadError}
            </PaneNotice>
          ) : (
            <div className="flex min-h-[200px] items-center justify-center">
              <PageSpinner />
            </div>
          )
        ) : (
          <>
            {detail.cancelReason ? (
              <PaneNotice tone="info" eyebrow={t('calledOffHeading')}>
                {t('calledOffDetail', { reason: detail.cancelReason })}
              </PaneNotice>
            ) : null}

            {changed ? (
              <PaneNotice
                eyebrow={t('changedHeading')}
                action={
                  <Button variant="outline" size="sm" onClick={onReload}>
                    {t('loadLatest')}
                  </Button>
                }
              >
                {t('changedDetail')}
              </PaneNotice>
            ) : null}

            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                {t('audienceHeading')}
              </span>
              <p className="text-[15px] leading-snug text-ink dark:text-foreground">
                {eligible > 0 ? t('audienceEligible', { count: eligible }) : t('audienceNone')}
                {leftOut > 0 ? ` · ${t('audienceLeftOut', { count: leftOut })}` : null}
              </p>
              {detail.audience.sample.length > 0 ? (
                <span className="text-[12.5px] text-ink-mute">
                  {t('sample', {
                    names: detail.audience.sample
                      .map((s) => s.name ?? s.address)
                      .join(', '),
                  })}
                </span>
              ) : null}
            </div>

            {detail.preview.warnings.map((warning) => (
              <PaneNotice key={warning} eyebrow={t('warning')}>
                {warning}
              </PaneNotice>
            ))}

            <BroadcastEmailPreview
              html={detail.preview.html}
              text={detail.preview.text}
              recipientName={detail.preview.recipient.name ?? detail.preview.recipient.address}
            />

            <div className="flex flex-col gap-2.5 border-t border-ink pt-4 dark:border-rule-on-dark">
              <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                {t('whenItGoes')}
              </span>
              <div className="flex flex-col border border-rule-soft dark:border-rule-on-dark">
                {scheduledAt ? (
                  <SendOption
                    selected={choice === 'scheduled'}
                    onSelect={() => setChoice('scheduled')}
                    label={t('sendScheduled', { when: stamp(scheduledAt) })}
                  />
                ) : null}
                <SendOption
                  selected={choice === 'now'}
                  onSelect={() => setChoice('now')}
                  label={t('sendNow')}
                />
                <SendOption
                  selected={choice === 'pick'}
                  onSelect={() => setChoice('pick')}
                  label={t('sendPick')}
                >
                  {choice === 'pick' ? (
                    <input
                      type="datetime-local"
                      value={pickedAt}
                      onChange={(e) => setPickedAt(e.target.value)}
                      onFocus={() => {
                        if (!pickedAt) setPickedAt(toDateTimeLocalValue(tomorrow()));
                      }}
                      className="h-[28px] min-w-0 rounded-input border border-rule-soft bg-paper px-2 py-0 font-sans text-[13px] leading-none text-ink outline-none focus-visible:border-cobalt dark:border-rule-on-dark dark:bg-card dark:text-foreground"
                    />
                  ) : null}
                </SendOption>
              </div>
              <p className="text-[12.5px] leading-snug text-ink-mute">{t('irreversible')}</p>
            </div>

            {testState.sentTo ? (
              <PaneNotice tone="info" eyebrow={t('testSentHeading')}>
                {t('testSentDetail', { to: testState.sentTo })}
              </PaneNotice>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule-soft pt-3 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute dark:border-rule-on-dark">
          <span>
            {detail?.proposedByActorType === 'user' ? t('draftedByUser') : t('draftedByAgent')} ·{' '}
            {age(item.createdAt)}
          </span>
          {detail ? <span>{t('htmlSize', { kb: Math.ceil(detail.preview.htmlBytes / 1000) })}</span> : null}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-rule-soft bg-paper dark:border-rule-on-dark dark:bg-background">
        <MoreActionsSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          actions={[
            {
              label: t('sendTest'),
              disabled: pending || !detail || testState.sending,
              run: () => void sendTest(),
            },
            { label: t('dismiss'), disabled: pending, run: onDismiss },
          ]}
        />
        <QueueActionErrorBanner
          error={actionError?.itemId === item.id && !changed ? actionError : null}
          onDismiss={onClearActionError}
        />
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 md:px-7">
          <Button
            variant="accent"
            disabled={!canApprove}
            onClick={approve}
            className="max-md:h-11 max-md:flex-1"
          >
            {choice === 'now'
              ? t('approveNow', { count: eligible })
              : t('approveScheduled', { count: eligible })}{' '}
            <span aria-hidden>→</span>
          </Button>
          <MoreActionsTrigger disabled={pending} onOpen={() => setMoreOpen(true)} />
          <Button
            variant="outline"
            disabled={pending || !detail || testState.sending}
            onClick={() => void sendTest()}
            className={cn('max-md:hidden')}
          >
            {testState.sending ? t('sendingTest') : t('sendTest')}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onDismiss} className="max-md:hidden">
            {t('dismiss')}
          </Button>
          <span className="hidden font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute md:ml-auto md:inline">
            {t('shortcutApprove')}
          </span>
        </div>
      </div>
    </section>
  );
}

function SendOption({
  selected,
  onSelect,
  label,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex min-h-[46px] cursor-pointer items-center gap-3 border-b border-rule-soft px-3.5 py-2 last:border-b-0 dark:border-rule-on-dark',
        selected ? 'bg-paper-deep dark:bg-card' : 'hover:bg-paper-deep dark:hover:bg-card',
      )}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="size-[9px] shrink-0 appearance-none rounded-full border border-ink-mute checked:border-cobalt checked:bg-cobalt dark:checked:border-cobalt-soft dark:checked:bg-cobalt-soft"
      />
      <span
        className={cn(
          'min-w-0 flex-1 text-[13.5px] leading-snug text-ink dark:text-foreground',
          !selected && 'text-ink-soft dark:text-foreground/70',
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function futureDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null;
  return at;
}

function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}
