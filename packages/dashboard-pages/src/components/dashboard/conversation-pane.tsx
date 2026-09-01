'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, DropdownMenuItem, PageSpinner, cn } from '@getmunin/ui';
import { CardMenu } from '../card-kit';
import { useRelative } from '../../lib/use-relative';
import { useConversationTyping } from '../../realtime';
import { useCmdEnter } from './queue-drawers/shared';
import { MessageBubble, startsAuthorGroup } from './inbox-message-bubble';
import { LoadFailed } from '../load-failed';
import { usePaneLoadFailedProps } from '../../lib/use-load-failed-props';
import {
  messageDraftKind,
  pendingDraftOf,
  type QueueController,
  type QueueItemDto,
} from './conversation-queue';
import type { ConversationDetail } from './inbox-types';

const COMPOSER_MAX_HEIGHT_PX = 320;

export function ConversationPane({
  selectedId,
  item,
  detail,
  controller,
  viewerUserId,
}: {
  selectedId: string | null;
  item: QueueItemDto | undefined;
  detail: ConversationDetail | undefined;
  controller: QueueController;
  viewerUserId: string | null;
}) {
  const t = useTranslations('dashboard.console.queue');
  const tCommon = useTranslations('common');
  const age = useRelative();
  const buildPaneLoadFailedProps = usePaneLoadFailedProps();

  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [reply, setReply] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const seededDraftId = useRef<string | null>(null);
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasDrafting = useRef(false);
  const replyRef = useRef('');
  replyRef.current = reply;
  const seededBody = useRef<string | null>(null);
  const { visitorTyping, notifyTyping, clearVisitorTyping } = useConversationTyping(selectedId);
  const replyBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const noteBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    for (const el of [replyBoxRef.current, noteBoxRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
    }
  }, [reply, noteDraft, tab, expanded]);

  const draft = pendingDraftOf(detail);

  const stopStream = () => {
    if (streamTimer.current) {
      clearInterval(streamTimer.current);
      streamTimer.current = null;
    }
    setStreaming(false);
  };

  useEffect(() => {
    stopStream();
    wasDrafting.current = false;
    seededDraftId.current = null;
    seededBody.current = null;
    setSuggestionId(null);
    setReply('');
    setNoteDraft('');
    setTab('reply');
    setExpanded(false);
  }, [selectedId]);

  useEffect(() => () => stopStream(), []);

  useEffect(() => {
    if (!draft || seededDraftId.current === draft.id) return;
    seededDraftId.current = draft.id;
    setSuggestionId(draft.id);
    const untouched =
      replyRef.current.trim() === '' || replyRef.current === seededBody.current;
    if (wasDrafting.current) {
      wasDrafting.current = false;
      stopStream();
      const body = draft.body;
      let shown = 0;
      setReply('');
      seededBody.current = body;
      setStreaming(true);
      streamTimer.current = setInterval(() => {
        shown = Math.min(body.length, shown + 4);
        setReply(body.slice(0, shown));
        if (shown >= body.length) stopStream();
      }, 24);
    } else if (untouched) {
      seededBody.current = draft.body;
      setReply(draft.body);
    }
  }, [draft]);

  useEffect(() => {
    if (!draft) setSuggestionId(null);
  }, [draft]);

  const thread = detail?.messages.filter((m) => messageDraftKind(m) === null) ?? [];
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = thread[thread.length - 1]?.id;
  const lastInboundId = [...thread].reverse().find((m) => m.authorType === 'end_user')?.id ?? null;
  useEffect(() => {
    if (lastInboundId) clearVisitorTyping();
  }, [lastInboundId, clearVisitorTyping]);
  const draftingSelected = selectedId ? !!controller.draftRequested[selectedId] : false;
  useEffect(() => {
    if (draftingSelected) wasDrafting.current = true;
  }, [draftingSelected]);
  useEffect(() => {
    for (const el of [bodyRef.current, scrollAreaRef.current]) {
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [selectedId, lastMessageId, thread.length, draftingSelected]);

  const isOpen = detail?.status === 'open';
  const claim = detail?.claim ?? null;
  const claimMine = !!claim && claim.holderId === viewerUserId;
  const canReply = isOpen && claimMine;
  const dirty = !streaming && !!draft && suggestionId !== null && reply !== draft.body;
  const reviewingDraft = suggestionId !== null && !dirty;

  const sendReply = (): void => {
    if (!selectedId || !reply.trim() || controller.pending || streaming) return;
    void controller.send(selectedId, reply, suggestionId ?? undefined).then((ok) => {
      if (ok) {
        setReply('');
        setExpanded(false);
      }
    });
  };

  useCmdEnter(() => {
    if (tab === 'reply' && canReply) sendReply();
  });

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    if (!(tab === 'reply' && reviewingDraft)) {
      (tab === 'note' ? noteBoxRef : replyBoxRef).current?.focus();
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, tab, reviewingDraft]);

  useEffect(() => {
    const el = composerRef.current;
    const viewport = typeof window === 'undefined' ? null : window.visualViewport;
    if (!expanded || !el || !viewport) return;
    const apply = () => {
      el.style.setProperty('--composer-height', `${viewport.height}px`);
      el.style.setProperty('--composer-top', `${viewport.offsetTop}px`);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      el.style.removeProperty('--composer-height');
      el.style.removeProperty('--composer-top');
    };
  }, [expanded]);

  if (!selectedId) {
    return (
      <section className="hidden min-h-0 flex-col items-start bg-paper-deep p-8 md:flex dark:bg-secondary">
        <span className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-mute">
          {t('selectEmpty')}
        </span>
      </section>
    );
  }

  if (!detail) {
    const detailError = controller.detailErrors[selectedId];
    return (
      <section className="flex min-h-0 flex-col bg-paper-deep dark:bg-secondary">
        {detailError ? (
          <div className="flex flex-1 flex-col justify-center px-8" role="alert">
            <LoadFailed
              {...buildPaneLoadFailedProps(
                t('detailFailed'),
                'Conversation · detail fetch failed',
                detailError,
                () => void controller.retryDetail(selectedId),
              )}
            />
          </div>
        ) : (
          <PageSpinner className="flex-1" />
        )}
      </section>
    );
  }

  const customer =
    item?.customerName ?? detail.contactName ?? detail.contactEmail ?? t('anonymous');
  const composerTitle = detail.subject ?? customer;
  const composerMeta = [item?.topicName, detail.subject ? customer : null]
    .filter((v): v is string => !!v)
    .join(' · ');
  const channelType = item?.channelType ?? '';
  const claimHolderName = item?.claim?.holderName ?? null;
  const askedForDraft = !!controller.draftRequested[detail.id];
  const drafting = askedForDraft || item?.agentWorking === true;
  const endUserSpokeLast =
    [...thread].reverse().find((m) => !m.internal)?.authorType === 'end_user';
  const agentCanDraft = !!detail.endUserId && item?.agentMode !== 'off';
  const draftInFlight = !!draft || drafting;
  const canAskDraft = canReply && endUserSpokeLast && agentCanDraft && !draftInFlight;
  const err = controller.actionError;

  const rejectAndClear = () => {
    void controller.rejectDraft(detail.id).then(() => {
      setSuggestionId(null);
      setReply('');
    });
  };

  const releaseClaim = () => {
    void controller.release(detail.id).then((ok) => {
      if (ok) setExpanded(false);
    });
  };

  const takeOverLabel = draft
    ? claim
      ? t('takeOverToReviewDraft')
      : t('claimToReviewDraft')
    : claim
      ? t('takeOverToReply')
      : t('claimToReply');

  const takeOverButton = (className: string) => (
    <Button
      variant="accent"
      className={className}
      onClick={() => void controller.takeOver(detail.id)}
      disabled={controller.pending}
      pending={controller.pendingAction === 'takeOver'}
    >
      {takeOverLabel} <span aria-hidden>→</span>
    </Button>
  );

  const closedFooter = (
    <div className="flex flex-col flex-wrap items-stretch gap-2.5 p-4 md:flex-row md:items-center md:px-5">
      <Button
        variant="outline"
        onClick={() => void controller.reopenConv(detail.id)}
        disabled={controller.pending}
        pending={controller.pendingAction === 'reopen'}
        className="max-md:h-11"
      >
        {t('reopen')}
      </Button>
    </div>
  );

  const claimGateCaption = claim ? (
    <span className="font-mono text-[9px] uppercase tracking-meta leading-relaxed text-ink-mute">
      {t('claimGateOther', { name: claimHolderName ?? t('teammate') })}
    </span>
  ) : null;

  const askDraftButton = (className?: string) =>
    canAskDraft ? (
      <Button
        variant="outline"
        className={className}
        onClick={() => void controller.requestDraft(detail.id)}
        disabled={controller.pending}
      >
        {t('askDraft')}
      </Button>
    ) : null;

  const originLine = drafting
    ? t('originDrafting')
    : draft
      ? t('originDrafted', { age: age(draft.createdAt) })
      : detail.needsHumanAttention && detail.needsHumanAttentionAt
        ? t('originStopped', { age: age(detail.needsHumanAttentionAt) })
        : detail.status;

  const metaParts = [
    `#${detail.displayId}`,
    item?.topicName ?? null,
    originLine,
    detail.contactPhone,
  ].filter((v): v is string => !!v);

  const editedByYou = canReply && tab === 'reply' && dirty;

  const composerState = !isOpen
    ? t('stateClosed')
    : streaming
      ? t('stateWriting')
      : drafting
        ? t('stateThinking')
        : !claim
        ? t('stateUnclaimed')
        : !claimMine
          ? t('stateOwnedBy', { name: claimHolderName ?? t('teammate') })
          : editedByYou
            ? t('draftEdited')
            : null;

  const statusAction = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={controller.pending}
      className="hidden shrink-0 uppercase underline underline-offset-[3px] text-ink-soft transition-colors duration-fast hover:text-ink disabled:no-underline disabled:opacity-50 md:inline dark:text-foreground/70 dark:hover:text-foreground"
    >
      {label}
    </button>
  );

  const statusSeparator = (
    <span aria-hidden className="hidden shrink-0 text-ink-mute md:inline">
      ·
    </span>
  );

  const mobileActionsMenu = canReply ? (
    <span className="-mr-[7px] ml-auto shrink-0 md:hidden">
      <CardMenu label={t('moreActions')} disabled={controller.pending}>
        <DropdownMenuItem onClick={releaseClaim}>{t('release')}</DropdownMenuItem>
        {editedByYou ? (
          <DropdownMenuItem onClick={() => setReply(draft.body)}>
            {t('restoreDraft')}
          </DropdownMenuItem>
        ) : null}
      </CardMenu>
    </span>
  ) : null;

  const statusStrip = (
    <span
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[9px] uppercase tracking-meta md:ml-auto md:justify-end',
        composerState ? 'max-md:w-full max-md:pb-2 max-md:pt-1' : 'max-md:hidden',
      )}
    >
      {canReply ? (
        <span className="hidden shrink-0 items-center gap-1.5 md:flex">
          <span className="text-ink-mute">{t('claimYours')}</span>
          {statusSeparator}
          {statusAction(t('release'), releaseClaim)}
        </span>
      ) : null}
      {composerState ? (
        <span className="flex min-w-0 items-center gap-1.5">
          {streaming || drafting ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-cobalt dark:bg-cobalt-soft"
            />
          ) : null}
          <span
            className={cn(
              'truncate',
              streaming || drafting ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
            )}
          >
            {composerState}
          </span>
          {editedByYou ? (
            <>
              {statusSeparator}
              {statusAction(t('restoreDraft'), () => setReply(draft.body))}
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );

  const errBanner = err ? (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 text-[13px] font-medium text-destructive md:px-5 dark:border-rule-on-dark"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="min-w-0 flex-1 truncate">
        {t(`actionFailed.${err.type}`)} · {err.message}
      </span>
      <button
        type="button"
        onClick={controller.clearActionError}
        className="shrink-0 underline underline-offset-[3px]"
      >
        {tCommon('close')}
      </button>
    </div>
  ) : null;

  return (
    <section className="flex min-h-0 flex-col bg-paper-deep dark:bg-secondary">
      <div ref={scrollAreaRef} className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto">
        <header className="shrink-0 border-b border-rule-soft px-5 pb-3 pt-4 max-md:hidden md:px-7 md:pt-5 dark:border-rule-on-dark">
          <div className="flex min-w-0 items-center gap-3">
            {channelType ? (
              <span className="shrink-0 bg-ink px-2 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-paper dark:bg-foreground dark:text-background">
                {channelType}
              </span>
            ) : null}
            <h2 className="min-w-0 truncate font-serif text-2xl font-normal leading-tight tracking-tight text-ink md:text-[32px] dark:text-foreground">
              {detail.subject ?? customer}
            </h2>
          </div>
          {detail.subject ? (
            <div className="mt-0.5 truncate text-[15px] text-ink md:text-[17px] dark:text-foreground">
              {customer}
            </div>
          ) : null}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
            {metaParts.map((part, i) => (
              <span key={`${i}-${part}`} className="flex min-w-0 items-center gap-2">
                {i > 0 ? <span aria-hidden>·</span> : null}
                <span className="truncate">{part}</span>
              </span>
            ))}
          </div>
        </header>

        <div ref={bodyRef} className="flex flex-col gap-4 px-5 py-5 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-7">
        {thread.map((m, i, arr) => (
          <MessageBubble
            key={m.id}
            message={m}
            showAuthor={startsAuthorGroup(m, arr[i - 1])}
          />
        ))}
        {visitorTyping ? (
          <div className="flex w-full flex-col items-start gap-1">
            <div
              className="flex items-center gap-1 rounded-bubble rounded-bl-[4px] border border-rule-soft bg-paper px-3.5 py-3 dark:border-rule-on-dark dark:bg-card"
              role="status"
              aria-live="polite"
              aria-label={t('customerTyping', { name: customer })}
            >
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  aria-hidden
                  className="size-1.5 animate-pulse rounded-full bg-ink-mute"
                  style={{ animationDelay: `${delay}ms`, animationDuration: '1.2s' }}
                />
              ))}
            </div>
          </div>
        ) : null}
        </div>
      </div>

      <footer className="shrink-0 border-t border-ink bg-paper dark:border-rule-on-dark dark:bg-background">
        {!expanded ? (
          <div className="md:hidden">
            {errBanner}
            {!isOpen ? (
              closedFooter
            ) : !canReply ? (
              <div className="flex flex-col items-stretch gap-2.5 p-4">
                {takeOverButton('h-11')}
                {claimGateCaption}
              </div>
            ) : suggestionId && !dirty && !streaming ? (
              <div className="p-4">
                <Button
                  variant="accent"
                  className="h-12 w-full"
                  onClick={() => setExpanded(true)}
                >
                  {t('reviewDraft')} <span aria-hidden>→</span>
                </Button>
              </div>
            ) : (
              <div className="flex items-stretch gap-2 p-4">
                <Button
                  variant="accent"
                  className="h-12 min-w-0 flex-1"
                  onClick={() => setExpanded(true)}
                >
                  {streaming || drafting ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 animate-pulse rounded-full bg-current"
                      />
                      {t(streaming ? 'stateWriting' : 'stateThinking')}
                    </span>
                  ) : (
                    <>
                      {reply.trim() ? t('continueReply') : t('writeReply')}{' '}
                      <span aria-hidden>→</span>
                    </>
                  )}
                </Button>
                {askDraftButton('h-12 shrink-0')}
              </div>
            )}
          </div>
        ) : null}
        <div
          ref={composerRef}
          role={expanded ? 'dialog' : undefined}
          aria-modal={expanded ? true : undefined}
          aria-label={expanded ? composerTitle : undefined}
          className={cn(
            expanded
              ? 'max-md:fixed max-md:inset-0 max-md:z-50 max-md:bg-paper dark:max-md:bg-background'
              : 'max-md:hidden',
          )}
        >
        <div
          className={cn(
            expanded
              ? 'md:contents max-md:mt-[var(--composer-top,0px)] max-md:flex max-md:h-[var(--composer-height,100dvh)] max-md:min-h-0 max-md:flex-col'
              : 'contents',
          )}
        >
        {expanded ? (
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ink bg-bone px-4 md:hidden dark:border-rule-on-dark dark:bg-background">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium leading-tight text-ink dark:text-foreground">
                {composerTitle}
              </span>
              {composerMeta ? (
                <span className="truncate font-mono text-[9px] uppercase tracking-meta text-ink-mute">
                  {composerMeta}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ml-auto flex shrink-0 items-center gap-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-soft dark:text-foreground/80"
            >
              {tCommon('close')}
              <X aria-hidden className="size-4 text-ink dark:text-foreground" />
            </button>
          </div>
        ) : null}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 border-b border-rule-soft px-4 md:px-5 dark:border-rule-on-dark">
          <button
            type="button"
            onClick={() => setTab('reply')}
            className={cn(
              'border-b-2 py-2.5 font-mono text-[10px] uppercase tracking-meta',
              tab === 'reply'
                ? 'border-cobalt text-ink dark:border-cobalt-soft dark:text-foreground'
                : 'border-transparent text-ink-mute',
            )}
          >
            {t('replyTab')}
          </button>
          <button
            type="button"
            onClick={() => setTab('note')}
            className={cn(
              'border-b-2 py-2.5 font-mono text-[10px] uppercase tracking-meta',
              tab === 'note'
                ? 'border-cobalt text-ink dark:border-cobalt-soft dark:text-foreground'
                : 'border-transparent text-ink-mute',
            )}
          >
            {t('noteTab')}
          </button>
          {mobileActionsMenu}
          {statusStrip}
        </div>

        {errBanner}

        {tab === 'reply' ? (
          !isOpen ? (
            closedFooter
          ) : canReply ? (
            <div className="flex flex-col gap-2.5 p-4 max-md:min-h-0 max-md:flex-1 md:px-5">
              <textarea
                ref={replyBoxRef}
                value={reply}
                readOnly={streaming || askedForDraft}
                onChange={(e) => {
                  setReply(e.target.value);
                  notifyTyping(e.target.value.trim().length > 0);
                  if (err) controller.clearActionError();
                }}
                rows={4}
                placeholder={t('replyPlaceholder', { name: customer })}
                className="w-full resize-none rounded-input border border-rule-soft bg-paper px-3.5 py-3 text-base leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt max-md:min-h-0 max-md:flex-1 md:text-sm dark:border-rule-on-dark dark:bg-card"
              />
              <div className="flex shrink-0 flex-col flex-wrap items-stretch gap-2 md:flex-row md:items-center">
                <Button
                  variant="accent"
                  onClick={sendReply}
                  disabled={controller.pending || streaming || askedForDraft || !reply.trim()}
                  pending={controller.pendingAction === 'send'}
                  className="max-md:h-11"
                >
                  {suggestionId && !dirty ? t('approveSend') : t('sendReply')}
                </Button>
                {suggestionId ? (
                  <Button
                    variant="outline"
                    onClick={rejectAndClear}
                    disabled={controller.pending || streaming}
                    className="max-md:h-11"
                  >
                    {t('rejectDraft')}
                  </Button>
                ) : null}
                {askDraftButton('max-md:h-11')}
                <Button
                  variant="ghost"
                  onClick={() =>
                    void controller.closeConv(detail.id).then((ok) => {
                      if (ok) setExpanded(false);
                    })
                  }
                  disabled={controller.pending}
                  className="max-md:h-11"
                >
                  {t('closeNoReply')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-wrap items-stretch gap-2.5 p-4 md:flex-row md:items-center md:px-5">
              {takeOverButton('max-md:h-11')}
              {claimGateCaption}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2.5 p-4 max-md:min-h-0 max-md:flex-1 md:px-5">
            <textarea
              ref={noteBoxRef}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={4}
              placeholder={t('notePlaceholder')}
              className="w-full resize-none rounded-input border border-amber-200 bg-amber-50 px-3.5 py-3 text-base leading-relaxed outline-none focus-visible:border-amber-500 focus-visible:ring-1 focus-visible:ring-amber-500 max-md:min-h-0 max-md:flex-1 md:text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
            />
            <div className="flex flex-col items-stretch gap-2.5 md:flex-row md:items-center">
              <Button
                onClick={() => {
                  if (!noteDraft.trim() || controller.pending) return;
                  void controller.addNote(detail.id, noteDraft).then((ok) => {
                    if (ok) {
                      setNoteDraft('');
                      setExpanded(false);
                    }
                  });
                }}
                disabled={controller.pending || !noteDraft.trim()}
                pending={controller.pendingAction === 'note'}
                className="max-md:h-11"
              >
                {t('addNote')}
              </Button>
              <span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-meta text-ink-mute">
                {t('noteHint')}
              </span>
            </div>
          </div>
        )}
        </div>
        </div>
      </footer>
    </section>
  );
}
