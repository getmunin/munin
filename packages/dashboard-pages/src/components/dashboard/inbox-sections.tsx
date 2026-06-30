'use client';

import { MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Pill, Sheet, SheetContent } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { QueueDrawer } from './queue-drawers';
import { queueLabelKey, queueTone } from './queue-drawers/types';
import type { QueueItem } from './queue-drawers/types';
import { useInboxData } from './inbox-data';
import { truncate } from './inbox-helpers';
import {
  DrawerLoadFailed,
  FullConvDrawer,
  InlineActionError,
  SimplifiedConvDrawer,
} from './inbox-conv-drawers';
import type {
  ConvActionError,
  ConversationDetail,
  ConversationSummary,
  InboxController,
} from './inbox-types';

export { useInboxData };
export type { ConvActionError, InboxController, QueueItem };

export function LiveNowSection({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.liveNow');
  const {
    items,
    details,
    pending,
    actionError,
    setConvDrawer,
    setReply,
    setDraftEdit,
    takeOver,
  } = controller;
  if (items.length === 0) return null;

  return (
    <section className="bg-paper-deep dark:bg-secondary relative left-1/2 right-1/2 -translate-x-1/2 w-screen py-6">
      <div className="max-w-7xl mx-auto px-4 md:px-10">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span
              className="size-2 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
              aria-hidden
            />
            <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
              {t('eyebrow')} · {items.length}
            </h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('subtitle')}
          </span>
        </div>
        <ul className="space-y-3">
          {items.map((c) => (
            <LiveCard
              key={c.id}
              conv={c}
              detail={details[c.id]}
              pending={pending}
              actionError={actionError?.conversationId === c.id ? actionError : null}
              onOpen={(mode) => {
                setReply('');
                setDraftEdit(null);
                setConvDrawer({ id: c.id, mode });
              }}
              onTakeOver={() => void takeOver(c.id, true)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

export function QueueSection({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.queue');
  const { queue, pending, setQueueDrawer, approveQueue, dismissQueue } = controller;
  if (queue.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b-[0.5px] border-rule-soft pb-2.5 dark:border-rule-on-dark">
        <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink dark:text-foreground">
          {t('eyebrow')} · {queue.length}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('sortedByRecency')}
        </span>
      </div>
      <ul>
        {queue.map((q) => (
          <QueueRow
            key={`${q.kind}-${q.id}`}
            item={q}
            pending={pending}
            onOpen={() => setQueueDrawer(q)}
            onApprove={() => void approveQueue(q)}
            onDismiss={() => void dismissQueue(q)}
          />
        ))}
      </ul>
    </section>
  );
}

export function InboxDrawers({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.drawer');
  const {
    convDrawer,
    setConvDrawer,
    queue,
    queueDrawer,
    setQueueDrawer,
    details,
    pending,
    reply,
    setReply,
    draftEdit,
    setDraftEdit,
    kbBodies,
    cmsDetails,
    detailErrors,
    queueDetailErrors,
    reloadDetail,
    reloadQueueDetail,
    actionError,
    clearActionError,
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
  const convError = convDrawer ? detailErrors[convDrawer.id] : null;
  const drawerActionError =
    convDrawer && actionError?.conversationId === convDrawer.id ? actionError : null;

  return (
    <>
      <Sheet
        open={convDrawer !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConvDrawer(null);
            setDraftEdit(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full max-w-[560px]">
          {convDrawer && selectedConv ? (
            convDrawer.mode === 'simplified' ? (
              <SimplifiedConvDrawer
                detail={selectedConv}
                pending={pending}
                draftEdit={draftEdit}
                setDraftEdit={setDraftEdit}
                actionError={drawerActionError}
                onSendDraft={(body) => void send(selectedConv.id, body, { claim: false, closeDrawer: true })}
                onTakeOver={() => void takeOver(selectedConv.id, true)}
                onClose={() => setConvDrawer(null)}
              />
            ) : (
              <FullConvDrawer
                detail={selectedConv}
                reply={reply}
                setReply={setReply}
                pending={pending}
                actionError={drawerActionError}
                onSend={() => void send(selectedConv.id, reply)}
                onTakeOver={() => void takeOver(selectedConv.id, false)}
                onRelease={() => void release(selectedConv.id)}
                onCloseConv={() => void closeConv(selectedConv.id)}
                onClose={() => setConvDrawer(null)}
                onClearActionError={clearActionError}
              />
            )
          ) : convDrawer && convError ? (
            <DrawerLoadFailed
              message={convError}
              retrying={pending}
              onRetry={() => void reloadDetail(convDrawer.id)}
              onClose={() => setConvDrawer(null)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-ink-mute">
              <MessageSquare className="mr-2 size-4" /> {t('loading')}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={queueDrawer !== null} onOpenChange={(o) => !o && setQueueDrawer(null)}>
        <SheetContent side="right" className="w-full max-w-[560px]">
          {queueDrawer && (
            <QueueDrawer
              item={queue.find((q) => q.id === queueDrawer.id) ?? queueDrawer}
              kbBody={queueDrawer.kind === 'kb' ? kbBodies[queueDrawer.id] : undefined}
              cmsDetail={
                queueDrawer.kind === 'cms' ? cmsDetails[queueDrawer.id] : undefined
              }
              detailError={queueDetailErrors[queueDrawer.id]}
              onRetryDetail={() => reloadQueueDetail(queueDrawer.id)}
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
    </>
  );
}

function LiveCard({
  conv,
  detail,
  pending,
  actionError,
  onOpen,
  onTakeOver,
}: {
  conv: ConversationSummary;
  detail: ConversationDetail | undefined;
  pending: boolean;
  actionError: ConvActionError;
  onOpen: (mode: 'simplified' | 'full') => void;
  onTakeOver: () => void;
}) {
  const t = useTranslations('dashboard.overview.liveNow');
  const tDrawer = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const claimed = detail?.claim != null;
  const flaggedAtMs = conv.needsHumanAttentionAt
    ? Date.parse(conv.needsHumanAttentionAt)
    : null;
  const lastEndUserMsg = detail?.messages
    .slice()
    .reverse()
    .find((m) => {
      if (m.authorType !== 'end_user') return false;
      if (flaggedAtMs == null) return true;
      return Date.parse(m.createdAt) <= flaggedAtMs;
    });
  const who = conv.endUserId ?? tDrawer('conversationFallback', { id: conv.displayId });
  const subject = conv.subject ?? tDrawer('conversationFallback', { id: conv.displayId });
  const waiting = conv.needsHumanAttentionAt
    ? age(conv.needsHumanAttentionAt)
    : conv.lastMessageAt
      ? age(conv.lastMessageAt)
      : '';

  const handleCardClick = () => onOpen(claimed ? 'full' : 'simplified');
  const retryAction =
    actionError?.type === 'takeOver'
      ? onTakeOver
      : null;

  return (
    <li className="space-y-0">
      <div
        className="group/livecard flex items-stretch gap-4 border-[0.5px] border-ink bg-paper px-5 py-4 cursor-pointer transition-colors duration-fast ease-munin hover:border-cobalt dark:border-rule-on-dark dark:bg-card dark:hover:border-cobalt-soft"
        onClick={handleCardClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            <span className="text-ink dark:text-foreground">{who}</span>
            {claimed ? (
              <span className="text-cobalt dark:text-cobalt-soft">{t('takenOver')}</span>
            ) : (
              <span className="text-cobalt dark:text-cobalt-soft">
                {t('waiting', { age: waiting })}
              </span>
            )}
          </div>
          <h3 className="font-serif text-xl leading-tight text-ink dark:text-foreground">
            {subject}
          </h3>
          {lastEndUserMsg && (
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{truncate(lastEndUserMsg.body, 160)}&rdquo;
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {actionError ? (
            <InlineActionError
              action={actionError.type}
              message={actionError.message}
              onRetry={retryAction}
            />
          ) : claimed ? (
            <Button variant="accent" size="sm" onClick={() => onOpen('full')}>
              {t('chat')}
            </Button>
          ) : (
            <>
              <Button
                variant="accent"
                size="sm"
                onClick={() => onOpen('simplified')}
                disabled={pending}
              >
                {t('reply')}
              </Button>
              <Button size="sm" onClick={onTakeOver} disabled={pending} pending={pending}>
                {t('takeOver')}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function QueueRow({
  item,
  pending,
  onOpen,
  onApprove,
  onDismiss,
}: {
  item: QueueItem;
  pending: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const tone = queueTone(item);
  const labelKey = queueLabelKey(item);
  return (
    <li className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark">
      <div
        className="group/qrow flex items-center gap-4 px-4 py-3 transition-colors duration-fast ease-munin hover:bg-paper-deep cursor-pointer dark:hover:bg-secondary"
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
        <span className="shrink-0">
          <Pill tone={tone}>{t(labelKey)}</Pill>
        </span>
        <div className="min-w-0 flex-1 truncate">
          <span className="text-sm font-medium text-ink dark:text-foreground">{item.title}</span>
          <span className="ml-2 text-sm text-ink-mute"> — {item.snippet}</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute group-hover/qrow:hidden">
          {age(item.createdAt)}
        </span>
        <div
          className="hidden shrink-0 items-center gap-2 group-hover/qrow:flex focus-within:flex"
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="accent" size="sm" onClick={onApprove} disabled={pending}>
            {t('approve')}
          </Button>
          <Button variant="outline" size="sm" onClick={onDismiss} disabled={pending}>
            {t('dismiss')}
          </Button>
        </div>
      </div>
    </li>
  );
}
