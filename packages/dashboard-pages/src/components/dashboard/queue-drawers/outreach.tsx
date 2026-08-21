'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  BodyDiff,
} from '@getmunin/ui';
import { Pill } from '@getmunin/ui';
import { useRelative } from '../../../lib/use-relative';
import {
  DrawerFooter,
  DrawerHeader,
  Markdown,
  ScheduledFooter,
  ScheduledNotice,
  toDateTimeLocalValue,
  useCmdEnter,
} from './shared';
import type { OutreachProposalDto } from './types';

export function OutreachQueueDrawer({
  item,
  pending,
  readOnly = false,
  onApprove,
  onDismiss,
  onSave,
  onCancelScheduled,
  onClose,
}: {
  item: { id: string; title: string; snippet: string; createdAt: string; raw: OutreachProposalDto };
  pending: boolean;
  readOnly?: boolean;
  onApprove: (sendAt?: string | null) => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onCancelScheduled?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const format = useFormatter();
  const initialBody = item.raw.draftBody;
  const originalDraftBody = item.raw.originalDraftBody ?? null;
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(initialBody);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [sendAt, setSendAt] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const proposedSendAt = futureDate(item.raw.proposedSendAt);

  useEffect(() => {
    setEditing(false);
    setEditedBody(initialBody);
    setSchedulerOpen(false);
    setScheduleError(null);
    setSendAt('');
  }, [item.id, initialBody]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditedBody(initialBody);
  }, [initialBody]);

  const saveEdit = async () => {
    if (!editedBody.trim() || pending) return;
    await onSave(editedBody);
    setEditing(false);
  };

  const openScheduler = () => {
    setSendAt(toDateTimeLocalValue(proposedSendAt ?? tomorrow()));
    setScheduleError(null);
    setSchedulerOpen(true);
  };

  const submitSchedule = () => {
    const at = new Date(sendAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      setScheduleError(t('outreachScheduleError'));
      return;
    }
    setScheduleError(null);
    setSchedulerOpen(false);
    onApprove(at.toISOString());
  };

  useCmdEnter(() => {
    if (pending || schedulerOpen || readOnly) return;
    if (editing) void saveEdit();
    else onApprove();
  });

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, cancelEdit]);

  const kind =
    item.raw.kind === 'reply'
      ? t('outreachKindReply')
      : item.raw.kind === 'followup'
        ? t('outreachKindFollowup', { step: item.raw.sequenceStep ?? 1 })
        : t('outreachKindInitial');
  const delivery = item.raw.delivery;
  const handle =
    delivery?.destination ??
    item.raw.contact?.email ??
    item.raw.campaign?.name ??
    t('handleFallback');
  const revisionCount = item.raw.revisionCount ?? 0;
  const stamp = (d: Date) =>
    format.dateTime(d, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const scheduledSendAt = item.raw.scheduledSendAt ? new Date(item.raw.scheduledSendAt) : null;

  return (
    <>
      <DrawerHeader
        pillTone="out"
        pillLabel={tQueue('kindOutreach')}
        title={item.title}
        meta={t('metaOutreach', { kind, handle, age: age(item.createdAt) })}
        rightExtra={readOnly ? <Pill tone="review">{t('scheduledPill')}</Pill> : undefined}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {readOnly && scheduledSendAt && (
          <ScheduledNotice
            headline={t('scheduledOutreachHeadline', { when: stamp(scheduledSendAt) })}
            detail={t('scheduledOutreachDetail', { handle })}
          />
        )}

        {revisionCount > 0 && (
          <section
            className={`border-l-2 px-3 py-2 text-xs ${
              item.raw.revisedAfterReviewAt
                ? 'border-alert-bad-border text-alert-bad-ink'
                : 'border-rule text-ink-mute'
            }`}
          >
            <p>
              {item.raw.revisedAfterReviewAt
                ? t('outreachRevisedAfterReview', { count: revisionCount })
                : t('outreachRevised', { count: revisionCount })}
            </p>
            {item.raw.lastRevisionReason && (
              <p className="mt-1">
                {t('outreachRevisionReason', { reason: item.raw.lastRevisionReason })}
              </p>
            )}
          </section>
        )}

        {originalDraftBody !== null && !editing && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('outreachOriginalDraft')}
            </p>
            <BodyDiff
              before={originalDraftBody}
              after={editedBody}
              unchangedLabel={t('outreachOriginalDraftUnchanged')}
            />
          </section>
        )}

        {item.raw.kind === 'reply' && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('replyFrom')}
            </p>
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{item.snippet}&rdquo;
            </p>
          </section>
        )}

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('proposal')}
          </p>
          {editing ? (
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={14}
              className="w-full resize-y rounded-input border-[1px] border-cobalt bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
              autoFocus
            />
          ) : (
            <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              {item.raw.draftSubject && (
                <p className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                  {t('subject', { subject: item.raw.draftSubject })}
                </p>
              )}
              <Markdown>{editedBody}</Markdown>
            </div>
          )}
        </section>

        {proposedSendAt && !editing && !readOnly && (
          <p className="border-l-2 border-rule px-3 py-2 text-xs text-ink-mute">
            {t('outreachProposedSendAt', { when: stamp(proposedSendAt) })}
          </p>
        )}

        {delivery && !editing && !readOnly && (
          <p
            className={`border-l-2 px-3 py-2 text-xs ${
              delivery.destination
                ? 'border-rule text-ink-mute'
                : 'border-alert-bad-border text-alert-bad-ink'
            }`}
          >
            {!delivery.destination
              ? t(
                  delivery.channelType === 'email'
                    ? 'outreachDeliveryNoEmail'
                    : 'outreachDeliveryNoPhone',
                )
              : t(
                  delivery.channelType === 'voice'
                    ? 'outreachDeliveryCall'
                    : delivery.channelType === 'sms'
                      ? 'outreachDeliverySms'
                      : 'outreachDeliveryEmail',
                  { destination: delivery.destination },
                )}
          </p>
        )}
      </div>

      <Dialog
        open={schedulerOpen}
        onOpenChange={(o) => {
          setSchedulerOpen(o);
          if (!o) setScheduleError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('outreachScheduleTitle')}</DialogTitle>
            <DialogDescription>{t('outreachScheduleDescription')}</DialogDescription>
          </DialogHeader>
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitSchedule();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                {t('outreachScheduleLabel')}
              </span>
              <input
                type="datetime-local"
                value={sendAt}
                onChange={(e) => {
                  setSendAt(e.target.value);
                  if (scheduleError) setScheduleError(null);
                }}
                className="rounded-input border-[1px] border-rule-soft bg-paper px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:border-rule-on-dark dark:bg-card dark:text-foreground"
                autoFocus
              />
            </label>
            {scheduleError && (
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-destructive">
                {scheduleError}
              </span>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSchedulerOpen(false)}>
                {t('outreachScheduleCancel')}
              </Button>
              <Button type="submit" variant="accent" disabled={pending || !sendAt}>
                {t('outreachScheduleConfirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {readOnly ? (
        <ScheduledFooter
          cancelLabel={t('scheduledOutreachCancel')}
          onCancel={() => onCancelScheduled?.()}
          disabled={pending || !onCancelScheduled}
          note={t('scheduledNote')}
        />
      ) : editing ? (
        <DrawerFooter
          primary={{
            label: t('save'),
            onClick: () => void saveEdit(),
            disabled: pending || !editedBody.trim(),
          }}
          secondary={[{ label: t('cancel'), onClick: cancelEdit }]}
          shortcut={t('shortcutSave')}
        />
      ) : (
        <DrawerFooter
          primary={{
            label: proposedSendAt
              ? t('outreachApproveScheduled', { when: stamp(proposedSendAt) })
              : t('approve'),
            onClick: () => onApprove(),
            disabled: pending,
          }}
          secondary={[
            { label: t('edit'), onClick: () => setEditing(true), disabled: pending },
            ...(proposedSendAt
              ? [
                  {
                    label: t('outreachSendNow'),
                    onClick: () => onApprove(null),
                    disabled: pending,
                  },
                ]
              : []),
            {
              label: proposedSendAt ? t('outreachReschedule') : t('outreachSchedule'),
              onClick: openScheduler,
              disabled: pending,
            },
            { label: t('dismiss'), onClick: onDismiss, disabled: pending },
          ]}
          shortcut={t('shortcutApprove')}
        />
      )}
    </>
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
