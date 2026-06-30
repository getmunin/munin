'use client';

import { useEffect, useRef } from 'react';
import { Unplug, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Pill } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { DrawerFooter, DrawerHeader, Markdown, useCmdEnter } from './queue-drawers/shared';
import { ActivityRail } from './inbox-activity-rail';
import { MessageBubble } from './inbox-message-bubble';
import type { ConvActionError, ConversationDetail } from './inbox-types';

export function InlineActionError({
  action,
  message,
  onRetry,
}: {
  action: NonNullable<ConvActionError>['type'];
  message: string;
  onRetry: (() => void) | null;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const reason = isConnectionMessage(message) ? t('actionFailedReasonConnection') : message;
  return (
    <div
      className="flex items-center gap-[14px] whitespace-nowrap border-[0.5px] border-cobalt bg-[oklch(0.98_0.025_25)] px-3 py-1.5 text-[13px] font-medium text-cobalt dark:border-cobalt-soft dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
      role="alert"
    >
      <span
        className="size-1.5 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
        aria-hidden
      />
      <span>
        {t(`actionFailedShort.${action}`)} · {reason}
      </span>
      {onRetry && (
        <button
          type="button"
          className="cursor-pointer text-[13px] font-medium text-cobalt underline underline-offset-[3px] hover:text-cobalt-deep dark:text-cobalt-soft"
          onClick={onRetry}
        >
          {t('retry')} <span aria-hidden>↻</span>
        </button>
      )}
    </div>
  );
}

function isConnectionMessage(msg: string): boolean {
  return /reach munin|check your connection|network/i.test(msg);
}

function retryHandler(
  err: NonNullable<ConvActionError>,
  onSend: () => void,
  onTakeOver: () => void,
  onRelease: () => void,
  onCloseConv: () => void,
): (() => void) | null {
  if (err.type === 'send') return onSend;
  if (err.type === 'takeOver') return onTakeOver;
  if (err.type === 'release') return onRelease;
  if (err.type === 'close') return onCloseConv;
  return null;
}

export function DrawerLoadFailed({
  message,
  retrying,
  onRetry,
  onClose,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tCommon = useTranslations('common');
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-destructive">
        {t('loadFailedEyebrow')}
      </div>
      <h2 className="font-serif text-xl leading-tight text-ink dark:text-foreground">
        {t('loadFailedTitle')}
      </h2>
      <p className="text-sm text-ink-mute">{message}</p>
      <div className="mt-2 flex items-center gap-3">
        <Button type="button" variant="accent" onClick={onRetry} disabled={retrying}>
          {retrying ? tCommon('retrying') : tCommon('retry')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {tCommon('close')}
        </Button>
      </div>
    </div>
  );
}

export function SimplifiedConvDrawer({
  detail,
  pending,
  draftEdit,
  setDraftEdit,
  actionError,
  onSendDraft,
  onTakeOver,
  onClose,
}: {
  detail: ConversationDetail;
  pending: boolean;
  draftEdit: string | null;
  setDraftEdit: (v: string | null) => void;
  actionError: ConvActionError;
  onSendDraft: (body: string) => void;
  onTakeOver: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const flaggedAtMs = detail.needsHumanAttentionAt
    ? Date.parse(detail.needsHumanAttentionAt)
    : null;
  const customer = detail.messages
    .slice()
    .reverse()
    .find((m) => {
      if (m.authorType !== 'end_user' || m.internal) return false;
      if (flaggedAtMs == null) return true;
      return Date.parse(m.createdAt) <= flaggedAtMs;
    });
  const draft = detail.messages
    .slice()
    .reverse()
    .find(
      (m) =>
        m.authorType === 'agent' &&
        m.internal &&
        m.metadata?.['kind'] === 'draft_reply',
    );

  const draftBody = draftEdit ?? draft?.body ?? '';
  const isEditing = draftEdit !== null || !draft;
  const waiting = detail.needsHumanAttentionAt ? age(detail.needsHumanAttentionAt) : '';
  const who =
    detail.contactEmail ??
    detail.contactName ??
    detail.endUserId ??
    t('conversationFallback', { id: detail.displayId });

  useCmdEnter(() => {
    if (draftBody.trim() && !pending) onSendDraft(draftBody);
  });

  return (
    <>
      <DrawerHeader
        pillTone="live"
        pillLabel={t('pillConversation')}
        title={detail.subject ?? t('conversationFallback', { id: detail.displayId })}
        meta={t('metaConv', { who, age: waiting })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {customer && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('customer')}
            </p>
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{customer.body}&rdquo;
            </p>
          </section>
        )}

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('agentDraft')}
          </p>
          {isEditing ? (
            <textarea
              value={draftBody}
              onChange={(e) => setDraftEdit(e.target.value)}
              rows={8}
              className="w-full rounded-input border-[0.5px] border-ink bg-paper px-4 py-3 text-base md:text-sm leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark dark:text-foreground"
              autoFocus
            />
          ) : (
            <div className="border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              <Markdown>{draft?.body ?? ''}</Markdown>
            </div>
          )}
        </section>
      </div>

      <div
        className={
          actionError
            ? 'border-t-[0.5px] border-cobalt dark:border-cobalt-soft'
            : undefined
        }
      >
        {actionError && (
          <div
            className="flex items-center gap-3 border-b-[0.5px] border-rule-soft bg-[oklch(0.98_0.025_25)] px-[26px] py-3 text-[13px] font-medium text-cobalt dark:border-rule-on-dark dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
            role="alert"
          >
            <span
              className="size-1.5 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
              aria-hidden
            />
            <span className="flex-1">
              {t(`actionFailedShort.${actionError.type}`)} ·{' '}
              {isConnectionMessage(actionError.message)
                ? t('actionFailedReasonConnection')
                : actionError.message}
            </span>
          </div>
        )}

        <DrawerFooter
          bordered={!actionError}
          primary={{
            label: actionError?.type === 'send' ? t('retryAction.send') : t('sendDraft'),
            onClick: () => onSendDraft(draftBody),
            disabled: pending || !draftBody.trim(),
          }}
          secondary={[
            draft
              ? isEditing
                ? { label: t('cancel'), onClick: () => setDraftEdit(null) }
                : {
                    label: t('edit'),
                    onClick: () => setDraftEdit(draft.body),
                  }
              : null,
            { label: t('takeOver'), onClick: onTakeOver, disabled: pending },
          ].filter((a): a is { label: string; onClick: () => void } => a !== null)}
          shortcut={t('shortcutSend')}
        />
      </div>
    </>
  );
}

export function FullConvDrawer({
  detail,
  reply,
  setReply,
  pending,
  actionError,
  onSend,
  onTakeOver,
  onRelease,
  onCloseConv,
  onClose,
  onClearActionError,
}: {
  detail: ConversationDetail;
  reply: string;
  setReply: (v: string) => void;
  pending: boolean;
  actionError: ConvActionError;
  onSend: () => void;
  onTakeOver: () => void;
  onRelease: () => void;
  onCloseConv: () => void;
  onClose: () => void;
  onClearActionError: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const claimed = detail.claim !== null;
  const endUserLabel =
    detail.contactEmail ?? detail.contactName ?? detail.endUserId ?? t('endUserFallback');

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = detail.messages[detail.messages.length - 1]?.id;
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [detail.id, lastMessageId, detail.messages.length]);

  useCmdEnter(() => {
    if (reply.trim() && !pending) onSend();
  });

  return (
    <>
      <DrawerHeader
        pillTone={detail.needsHumanAttention ? 'live' : detail.status === 'open' ? 'ink' : 'draft'}
        pillLabel={detail.needsHumanAttention ? t('pillLive') : detail.status}
        title={detail.subject ?? t('conversationFallback', { id: detail.displayId })}
        meta={t('metaConvFull', { who: endUserLabel, status: detail.status })}
        rightExtra={
          claimed ? (
            <Pill tone="review" className="before:hidden">
              <User className="size-3" /> {t('pillTakenOver')}
            </Pill>
          ) : null
        }
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div ref={messagesRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
        {detail.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <ActivityRail contactId={detail.contactId} conversationId={detail.id} />

      <div
        className={
          actionError
            ? 'border-t-[0.5px] border-cobalt dark:border-cobalt-soft'
            : 'border-t-[0.5px] border-rule-soft dark:border-rule-on-dark'
        }
      >
        {actionError && (
          <div
            className="flex items-center gap-3 border-b-[0.5px] border-rule-soft bg-[oklch(0.98_0.025_25)] px-[26px] py-3 text-[13px] font-medium text-cobalt dark:border-rule-on-dark dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
            role="alert"
          >
            <span
              className="size-1.5 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
              aria-hidden
            />
            <span className="flex-1">
              {t(`actionFailedShort.${actionError.type}`)} ·{' '}
              {isConnectionMessage(actionError.message)
                ? t('actionFailedReasonConnection')
                : actionError.message}
            </span>
            {retryHandler(actionError, onSend, onTakeOver, onRelease, onCloseConv) ? (
              <button
                type="button"
                className="cursor-pointer text-[13px] font-medium text-cobalt underline underline-offset-[3px] hover:text-cobalt-deep dark:text-cobalt-soft"
                onClick={retryHandler(actionError, onSend, onTakeOver, onRelease, onCloseConv)!}
                disabled={pending}
              >
                {t(`retryAction.${actionError.type}`)} <span aria-hidden>↵</span>
              </button>
            ) : null}
          </div>
        )}
        <div className="p-4">
          <textarea
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              if (actionError) onClearActionError();
            }}
            rows={3}
            placeholder={t('replyPlaceholder')}
            className="w-full rounded-input border-[0.5px] border-rule-soft bg-paper px-3 py-2 text-base md:text-sm outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!claimed ? (
                <Button size="sm" onClick={onTakeOver} disabled={pending} pending={pending}>
                  {t('takeOver')}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={onRelease} disabled={pending}>
                  <Unplug className="size-3.5" /> {t('release')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onCloseConv} disabled={pending}>
                {t('closeConv')}
              </Button>
            </div>
            <Button
              size="sm"
              variant="accent"
              onClick={onSend}
              disabled={pending || !reply.trim()}
              pending={pending}
            >
              {actionError?.type === 'send' ? t('retryAction.send') : t('send')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
