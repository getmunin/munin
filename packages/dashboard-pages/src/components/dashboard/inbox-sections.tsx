'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
} from '@getmunin/ui';
import { useCountdown } from '../../lib/use-relative';
import { QueueDrawer, ScheduledDrawer } from './queue-drawers';
import { DrawerHeader, DrawerLoadFailed, RowCode } from './queue-drawers/shared';
import { queueCodeKey } from './queue-drawers/types';
import type { QueueItem, ScheduledItem } from './queue-drawers/types';
import { useInboxData } from './inbox-data';
import { QueueActionErrorBanner } from './queue-action-error';
import { ConversationDrawer } from './inbox-conv-drawers';
import type { ConvActionError, InboxController } from './inbox-types';

export { useInboxData };
export type { ConvActionError, InboxController, QueueItem, ScheduledItem };

export function ScheduledSection({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.scheduled');
  const { scheduled, pending, setScheduledDrawer, setCancelTarget } = controller;
  if (scheduled.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b-[1px] border-rule-soft pb-2.5 dark:border-rule-on-dark">
        <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink dark:text-foreground">
          {t('eyebrow')} · {scheduled.length}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('subtitle')}
        </span>
      </div>
      <ul>
        {scheduled.map((s) => (
          <ScheduledRow
            key={`${s.kind}-${s.id}`}
            item={s}
            pending={pending}
            onOpen={() => setScheduledDrawer(s)}
            onCancel={() => setCancelTarget(s)}
          />
        ))}
      </ul>
    </section>
  );
}

function ScheduledCancelDialog({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.scheduled');
  const { cancelTarget, setCancelTarget, pending, cancelScheduledSend, cancelScheduledPublish } =
    controller;
  const [reason, setReason] = useState('');
  const needsReason = cancelTarget?.kind === 'outreach';
  const isCms = cancelTarget?.kind === 'cms';

  useEffect(() => {
    if (cancelTarget) setReason('');
  }, [cancelTarget]);

  const submit = async () => {
    if (!cancelTarget) return;
    if (needsReason && !reason.trim()) return;
    try {
      if (cancelTarget.kind === 'outreach') {
        await cancelScheduledSend(cancelTarget.id, reason.trim());
      } else {
        await cancelScheduledPublish(cancelTarget.id);
      }
    } catch (err) {
      console.warn('[scheduled] cancel failed', err);
    }
  };

  return (
    <Dialog
      open={cancelTarget !== null}
      onOpenChange={(o) => {
        if (!o) setCancelTarget(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCms ? t('cancelCmsTitle') : t('cancelTitle')}</DialogTitle>
          <DialogDescription>
            {isCms ? t('cancelCmsDescription') : t('cancelDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {needsReason && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                {t('cancelReasonLabel')}
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                className="rounded-input border-[1px] border-rule-soft bg-paper px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:border-rule-on-dark dark:bg-card dark:text-foreground"
                autoFocus
              />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelTarget(null)}>
              {t('cancelDismiss')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={pending || (needsReason && !reason.trim())}
            >
              {isCms ? t('cancelCmsConfirm') : t('cancelConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScheduledRow({
  item,
  pending,
  onOpen,
  onCancel,
}: {
  item: ScheduledItem;
  pending: boolean;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('dashboard.overview.scheduled');
  const tQueue = useTranslations('dashboard.overview.queue');
  const countdown = useCountdown();

  return (
    <li className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
      <div
        className="group/srow flex items-center gap-4 px-4 py-3 transition-colors duration-fast ease-munin hover:bg-paper-deep cursor-pointer dark:hover:bg-secondary"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <RowCode kind={item.kind}>{tQueue(queueCodeKey(item.kind))}</RowCode>
        <div className="min-w-0 flex-1 truncate">
          <span className="text-sm font-medium text-ink dark:text-foreground">{item.title}</span>
          <span className="ml-2 text-sm text-ink-mute"> — {item.snippet}</span>
        </div>
        <span className="flex h-7 shrink-0 items-center whitespace-nowrap font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute group-hover/srow:hidden">
          {countdown(item.at)}
        </span>
        <div
          className="hidden shrink-0 items-center gap-2 group-hover/srow:flex focus-within:flex"
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    </li>
  );
}

export function InboxDrawers({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.drawer');
  const tCommon = useTranslations('common');
  const {
    convDrawer,
    setConvDrawer,
    queue,
    queueDrawer,
    setQueueDrawer,
    scheduled,
    scheduledDrawer,
    setScheduledDrawer,
    setCancelTarget,
    details,
    pending,
    reply,
    setReply,
    kbBodies,
    kbRevisedBodies,
    cmsDetails,
    detailErrors,
    queueDetailErrors,
    reloadDetail,
    reloadQueueDetail,
    actionError,
    clearActionError,
    queueActionError,
    clearQueueActionError,
    send,
    takeOver,
    release,
    closeConv,
    approveQueue,
    saveQueue,
    saveCmsDraft,
    uploadCmsAsset,
    dismissQueue,
    scheduleQueue,
  } = controller;
  const selectedConv = convDrawer ? details[convDrawer.id] : null;
  const convLoadError = convDrawer ? detailErrors[convDrawer.id] : null;
  const drawerActionError =
    convDrawer && actionError?.conversationId === convDrawer.id ? actionError : null;

  return (
    <>
      <Sheet
        open={convDrawer !== null}
        onOpenChange={(o) => {
          if (!o) setConvDrawer(null);
        }}
      >
        <SheetContent side="right" className="w-full max-w-[560px]">
          {convDrawer && selectedConv ? (
            <ConversationDrawer
              detail={selectedConv}
              reply={reply}
              setReply={setReply}
              pending={pending}
              actionError={drawerActionError}
              onSend={(body, fromDraftId) =>
                void send(selectedConv.id, body, { claim: false, fromDraftId })
              }
              onTakeOver={() => void takeOver(selectedConv.id, false)}
              onRelease={() => void release(selectedConv.id)}
              onCloseConv={() => void closeConv(selectedConv.id)}
              onClose={() => setConvDrawer(null)}
              onClearActionError={clearActionError}
            />
          ) : convDrawer && convLoadError ? (
            <>
              <DrawerHeader
                pillTone="ink"
                pillLabel={t('pillConversation')}
                title={convDrawer.title ?? t('conversationUnknown')}
                onClose={() => setConvDrawer(null)}
                closeLabel={t('close')}
              />
              <DrawerLoadFailed
                eyebrow={t('loadFailedEyebrow')}
                title={t('loadFailedTitle')}
                reason={convLoadError}
                retryLabel={tCommon('retry')}
                retryingLabel={tCommon('retrying')}
                onRetry={() => reloadDetail(convDrawer.id)}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-ink-mute">
              <MessageSquare className="mr-2 size-4" /> {t('loading')}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={queueDrawer !== null} onOpenChange={(o) => !o && setQueueDrawer(null)}>
        <SheetContent side="right" className="w-full max-w-[560px]">
          <QueueActionErrorBanner
            error={queueActionError?.itemId === queueDrawer?.id ? queueActionError : null}
            onDismiss={clearQueueActionError}
          />
          {queueDrawer && (
            <QueueDrawer
              item={queue.find((q) => q.id === queueDrawer.id) ?? queueDrawer}
              kbBody={queueDrawer.kind === 'kb' ? kbBodies[queueDrawer.id] : undefined}
              kbRevisedBody={
                queueDrawer.kind === 'kb' ? kbRevisedBodies[queueDrawer.id] : undefined
              }
              cmsDetail={
                queueDrawer.kind === 'cms' ? cmsDetails[queueDrawer.id] : undefined
              }
              loadError={queueDetailErrors[queueDrawer.id]}
              onRetry={() => reloadQueueDetail(queueDrawer.id)}
              pending={pending}
              onApprove={() => void approveQueue(queueDrawer)}
              onDismiss={() => void dismissQueue(queueDrawer)}
              onSave={(body) => saveQueue(queueDrawer, body)}
              onSaveCmsDraft={(data) => saveCmsDraft(queueDrawer, data)}
              onUploadCmsAsset={(file) => uploadCmsAsset(queueDrawer, file)}
              onSchedule={(scheduledAt) => scheduleQueue(queueDrawer, scheduledAt)}
              onClose={() => setQueueDrawer(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={scheduledDrawer !== null}
        onOpenChange={(o) => !o && setScheduledDrawer(null)}
      >
        <SheetContent side="right" className="w-full max-w-[560px]">
          {scheduledDrawer && (
            <ScheduledDrawer
              item={
                scheduled.find(
                  (s) => s.kind === scheduledDrawer.kind && s.id === scheduledDrawer.id,
                ) ?? scheduledDrawer
              }
              cmsDetail={
                scheduledDrawer.kind === 'cms' ? cmsDetails[scheduledDrawer.id] : undefined
              }
              loadError={queueDetailErrors[scheduledDrawer.id]}
              onRetry={() => reloadQueueDetail(scheduledDrawer.id)}
              pending={pending}
              onCancel={() => setCancelTarget(scheduledDrawer)}
              onClose={() => setScheduledDrawer(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <ScheduledCancelDialog controller={controller} />
    </>
  );
}

