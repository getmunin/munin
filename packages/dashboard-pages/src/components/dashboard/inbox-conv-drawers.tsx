'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Unplug, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Pill } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { DrawerHeader, useCmdEnter } from './queue-drawers/shared';
import { ActivityRail } from './inbox-activity-rail';
import { MessageBubble } from './inbox-message-bubble';
import type { ConvActionError, ConversationDetail, MessageDto } from './inbox-types';

export function InlineActionError({
  error,
  onRetry,
}: {
  error: NonNullable<ConvActionError>;
  onRetry: (() => void) | null;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tCommon = useTranslations('common');
  const action = error.type;
  const reason = actionErrorReason(error, t);
  return (
    <div
      className="flex items-center gap-[14px] whitespace-nowrap border-[1px] border-cobalt bg-[oklch(0.98_0.025_25)] px-3 py-1.5 text-[13px] font-medium text-cobalt dark:border-cobalt-soft dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
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
          {tCommon('retry')} <span aria-hidden>↻</span>
        </button>
      )}
    </div>
  );
}

function actionErrorReason(
  error: NonNullable<ConvActionError>,
  t: ReturnType<typeof useTranslations<'dashboard.overview.drawer'>>,
): string {
  return error.code === 'NETWORK_ERROR' ? t('actionFailedReasonConnection') : error.message;
}

const DRAFT_KINDS = ['draft_reply', 'draft_reply_sent', 'draft_reply_superseded'] as const;

function draftKind(message: MessageDto): (typeof DRAFT_KINDS)[number] | null {
  if (!message.internal || message.authorType !== 'agent') return null;
  const kind = message.metadata?.['kind'];
  return DRAFT_KINDS.find((k) => k === kind) ?? null;
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

export type ConversationDetailVariant = 'drawer' | 'pane' | 'page';

export function ConversationDrawer(props: ConversationDetailViewProps) {
  return <ConversationDetailView {...props} />;
}

export interface ConversationDetailViewProps {
  detail: ConversationDetail;
  reply: string;
  setReply: (v: string) => void;
  pending: boolean;
  actionError: ConvActionError;
  onSend: (body: string, fromDraftId?: string) => void;
  onTakeOver: () => void;
  onRelease: () => void;
  onCloseConv: () => void;
  onClose: () => void;
  onClearActionError: () => void;
  variant?: ConversationDetailVariant;
  backLabel?: string;
}

export function ConversationDetailView({
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
  variant = 'drawer',
  backLabel,
}: ConversationDetailViewProps) {
  const t = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const claimed = detail.claim !== null;
  const endUserLabel =
    detail.contactEmail ?? detail.contactName ?? detail.endUserId ?? t('endUserFallback');

  const draft = detail.messages
    .slice()
    .reverse()
    .find((m) => draftKind(m) === 'draft_reply');
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const seededDraftId = useRef<string | null>(null);

  useEffect(() => {
    seededDraftId.current = null;
    setSuggestionId(null);
    setReply('');
  }, [detail.id, setReply]);

  useEffect(() => {
    if (!draft || seededDraftId.current === draft.id) return;
    seededDraftId.current = draft.id;
    setSuggestionId(draft.id);
    setReply(draft.body);
  }, [draft, setReply]);

  useEffect(() => {
    if (suggestionId && draft?.id !== suggestionId) setSuggestionId(null);
  }, [draft, suggestionId]);

  const thread = detail.messages.filter((m) => draftKind(m) === null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = thread[thread.length - 1]?.id;
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [detail.id, lastMessageId, thread.length]);

  const submit = (): void => onSend(reply, suggestionId ?? undefined);

  useCmdEnter(() => {
    if (reply.trim() && !pending) submit();
  });

  const title = detail.subject ?? t('conversationFallback', { id: detail.displayId });
  const meta =
    detail.needsHumanAttention && detail.needsHumanAttentionAt
      ? t('metaConv', { who: endUserLabel, age: age(detail.needsHumanAttentionAt) })
      : t('metaConvFull', { who: endUserLabel, status: detail.status });
  const claimPill = claimed ? (
    <Pill tone="review" className="before:hidden">
      <User className="size-[9px]" /> {t('pillTakenOver')}
    </Pill>
  ) : null;

  return (
    <>
      {variant === 'page' ? (
        <>
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b-[1px] border-rule-soft px-4 dark:border-rule-on-dark">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2.5 py-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-ink-soft dark:text-foreground/75"
            >
              <ArrowLeft className="size-4 shrink-0 text-ink dark:text-foreground" aria-hidden />
              {backLabel ?? t('close')}
            </button>
            <span className="ml-auto shrink-0">{claimPill}</span>
          </div>
          <div className="shrink-0 px-4 pb-1 pt-4">
            <h2 className="m-0 font-serif text-[26px] font-normal leading-tight text-ink dark:text-foreground">
              {title}
            </h2>
            <p className="mt-1.5 text-[12.5px] text-ink-mute dark:text-foreground/55">{meta}</p>
          </div>
        </>
      ) : (
        <DrawerHeader
          pillTone={detail.needsHumanAttention ? 'live' : detail.status === 'open' ? 'ink' : 'draft'}
          pillLabel={detail.needsHumanAttention ? t('pillLive') : detail.status}
          title={title}
          meta={meta}
          rightExtra={claimPill}
          onClose={variant === 'pane' ? undefined : onClose}
          closeLabel={t('close')}
        />
      )}

      <div ref={messagesRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
        {thread.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <ActivityRail contactId={detail.contactId} conversationId={detail.id} />

      <div
        className={
          actionError
            ? 'border-t-[1px] border-cobalt dark:border-cobalt-soft'
            : 'border-t-[1px] border-rule-soft dark:border-rule-on-dark'
        }
      >
        {actionError && (
          <div
            className="flex items-center gap-3 border-b-[1px] border-rule-soft bg-[oklch(0.98_0.025_25)] px-[26px] py-3 text-[13px] font-medium text-cobalt dark:border-rule-on-dark dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
            role="alert"
          >
            <span
              className="size-1.5 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
              aria-hidden
            />
            <span className="flex-1">
              {t(`actionFailedShort.${actionError.type}`)} ·{' '}
              {actionErrorReason(actionError, t)}
            </span>
            {retryHandler(actionError, submit, onTakeOver, onRelease, onCloseConv) ? (
              <button
                type="button"
                className="cursor-pointer text-[13px] font-medium text-cobalt underline underline-offset-[3px] hover:text-cobalt-deep dark:text-cobalt-soft"
                onClick={retryHandler(actionError, submit, onTakeOver, onRelease, onCloseConv)!}
                disabled={pending}
              >
                {t(`retryAction.${actionError.type}`)} <span aria-hidden>↵</span>
              </button>
            ) : null}
          </div>
        )}
        <div className="p-4">
          {suggestionId && (
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
                {t('suggestionLabel')}
              </span>
              <button
                type="button"
                className="cursor-pointer font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute underline underline-offset-[3px] hover:text-ink dark:hover:text-foreground"
                onClick={() => {
                  setSuggestionId(null);
                  setReply('');
                }}
              >
                {t('suggestionDiscard')}
              </button>
            </div>
          )}
          <textarea
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              if (actionError) onClearActionError();
            }}
            rows={suggestionId ? 8 : 3}
            placeholder={t('replyPlaceholder')}
            className="w-full rounded-input border-[1px] border-rule-soft bg-paper px-3 py-2 text-base md:text-sm outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark"
          />
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="accent"
              onClick={submit}
              disabled={pending || !reply.trim()}
              pending={pending}
            >
              {actionError?.type === 'send' ? t('retryAction.send') : t('send')}
            </Button>
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
        </div>
      </div>
    </>
  );
}
