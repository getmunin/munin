'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, PageSpinner, cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { useCmdEnter } from './queue-drawers/shared';
import { MessageBubble } from './inbox-message-bubble';
import {
  messageDraftKind,
  pendingDraftOf,
  type QueueController,
  type QueueItemDto,
} from './conversation-queue';
import type { ConversationDetail, MessageDto } from './inbox-types';

function isNoteMessage(message: MessageDto): boolean {
  return message.internal && messageDraftKind(message) === null && message.authorType !== 'system';
}

export function ConversationPane({
  selectedId,
  item,
  detail,
  controller,
  viewerUserId,
  onBack,
}: {
  selectedId: string | null;
  item: QueueItemDto | undefined;
  detail: ConversationDetail | undefined;
  controller: QueueController;
  viewerUserId: string | null;
  onBack: () => void;
}) {
  const t = useTranslations('dashboard.console.queue');
  const tCommon = useTranslations('common');
  const age = useRelative();

  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [reply, setReply] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const seededDraftId = useRef<string | null>(null);
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasDrafting = useRef(false);
  const replyBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const noteBoxRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    for (const el of [replyBoxRef.current, noteBoxRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    }
  });

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
    if (wasDrafting.current) {
      wasDrafting.current = false;
      const body = draft.body;
      let shown = 0;
      setReply('');
      setStreaming(true);
      streamTimer.current = setInterval(() => {
        shown = Math.min(body.length, shown + 4);
        setReply(body.slice(0, shown));
        if (shown >= body.length) stopStream();
      }, 24);
    } else {
      setReply(draft.body);
    }
  }, [draft]);

  useEffect(() => {
    if (suggestionId && draft?.id !== suggestionId) setSuggestionId(null);
  }, [draft, suggestionId]);

  const thread = detail?.messages.filter((m) => messageDraftKind(m) === null) ?? [];
  const noteCount = thread.filter(isNoteMessage).length;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = thread[thread.length - 1]?.id;
  const draftingSelected = selectedId ? !!controller.draftRequested[selectedId] : false;
  useEffect(() => {
    if (draftingSelected) wasDrafting.current = true;
  }, [draftingSelected]);
  useEffect(() => {
    for (const el of [bodyRef.current, scrollAreaRef.current]) {
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [selectedId, lastMessageId, thread.length, draftingSelected]);

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
    return (
      <section className="flex min-h-0 flex-col bg-paper-deep dark:bg-secondary">
        <PageSpinner className="flex-1" />
      </section>
    );
  }

  const customer =
    item?.customerName ?? detail.contactName ?? detail.contactEmail ?? t('anonymous');
  const channelType = item?.channelType ?? '';
  const isOpen = detail.status === 'open';
  const claim = detail.claim;
  const claimMine = !!claim && claim.holderId === viewerUserId;
  const claimHolderName = item?.claim?.holderName ?? null;
  const canReply = isOpen && claimMine;
  const drafting = !!controller.draftRequested[detail.id];
  const canAskDraft =
    isOpen && !draft && !drafting && !!detail.endUserId && item?.agentMode !== 'off';
  const dirty = !streaming && !!draft && suggestionId !== null && reply !== draft.body;
  const err = controller.actionError;

  const originLine = drafting
    ? t('originDrafting')
    : draft
      ? t('originDrafted', { age: age(draft.createdAt) })
      : detail.needsHumanAttention && detail.needsHumanAttentionAt
        ? t('originStopped', { age: age(detail.needsHumanAttentionAt) })
        : detail.status;

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
          : dirty
            ? t('stateEdited')
            : draft
              ? t('stateDraftReady')
              : t('stateNoDraft');

  const errBanner = err ? (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-rule-soft px-5 py-2.5 text-[13px] font-medium text-cobalt dark:border-rule-on-dark dark:text-cobalt-soft"
    >
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
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
        <header className="shrink-0 border-b border-ink bg-paper px-5 pb-4 pt-5 md:min-h-[146px] md:px-7 md:pt-6 dark:border-rule-on-dark dark:bg-background">
          <button
            type="button"
            onClick={onBack}
            className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-soft md:hidden dark:text-foreground/80"
          >
            <ArrowLeft aria-hidden className="size-4" /> {t('backToQueue')}
          </button>
          <div className="flex min-w-0 items-center gap-3">
            {channelType ? (
              <span className="shrink-0 bg-ink px-2 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-paper dark:bg-foreground dark:text-background">
                {channelType}
              </span>
            ) : null}
            <h2 className="min-w-0 truncate font-serif text-2xl font-normal leading-tight tracking-tight text-ink md:text-[32px] dark:text-foreground">
              {detail.subject ?? customer}
            </h2>
            <span className="shrink-0 font-mono text-xs text-ink-mute">#{detail.displayId}</span>
          </div>
          {detail.subject ? (
            <div className="mt-2 truncate text-[15px] text-ink md:text-[17px] dark:text-foreground">
              {customer}
            </div>
          ) : null}
          <div className="mt-2 flex min-w-0 gap-2 truncate font-mono text-[10px] uppercase tracking-meta text-ink-mute">
            {item?.topicName ? <span className="shrink-0">{item.topicName}</span> : null}
            {item?.topicName ? <span aria-hidden>·</span> : null}
            <span className="truncate">{originLine}</span>
          </div>
        </header>

        <div ref={bodyRef} className="space-y-3 px-5 py-5 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-7">
        {thread.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        </div>
      </div>

      <footer className="shrink-0 border-t border-ink bg-paper dark:border-rule-on-dark dark:bg-background">
        {!expanded ? (
          <div className="md:hidden">
            {errBanner}
            {!isOpen ? (
              <div className="px-5 py-4 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
                {t('readOnlyClosed')}
              </div>
            ) : !canReply ? (
              <div className="flex flex-col items-stretch gap-2.5 p-4">
                <Button
                  variant="accent"
                  className="h-11"
                  onClick={() => void controller.takeOver(detail.id)}
                  disabled={controller.pending}
                  pending={controller.pendingAction === 'takeOver'}
                >
                  {claim ? t('takeOverToReply') : t('claimToReply')} <span aria-hidden>→</span>
                </Button>
                <span className="font-mono text-[9px] uppercase tracking-meta leading-relaxed text-ink-mute">
                  {claim
                    ? t('claimGateOther', { name: claimHolderName ?? t('teammate') })
                    : t('claimGateFree')}
                </span>
              </div>
            ) : suggestionId && !dirty && !streaming ? (
              <div className="flex flex-col gap-2 p-4">
                <Button
                  variant="accent"
                  className="h-11"
                  onClick={sendReply}
                  disabled={controller.pending || !reply.trim()}
                  pending={controller.pendingAction === 'send'}
                >
                  {t('approveSend')} <span aria-hidden>→</span>
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-11" onClick={() => setExpanded(true)}>
                    {t('editDraft')}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11"
                    disabled={controller.pending}
                    onClick={() => {
                      void controller.rejectDraft(detail.id).then(() => {
                        setSuggestionId(null);
                        setReply('');
                      });
                    }}
                  >
                    {t('reject')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-stretch gap-2 p-4">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="block h-11 min-w-0 flex-1 truncate rounded-input border border-rule-soft bg-paper px-3.5 text-left text-sm leading-[42px] dark:border-rule-on-dark dark:bg-card"
                >
                  {streaming || drafting ? (
                    <span className="inline-flex max-w-full items-center gap-1.5 truncate text-cobalt dark:text-cobalt-soft">
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 animate-pulse rounded-full bg-current"
                      />
                      {reply.trim() || t(streaming ? 'stateWriting' : 'stateThinking')}
                    </span>
                  ) : reply.trim() ? (
                    reply
                  ) : (
                    <span className="text-ink-mute">
                      {t('replyPlaceholder', { name: customer })}
                    </span>
                  )}
                </button>
                {canAskDraft ? (
                  <Button
                    variant="ghost"
                    className="h-11 shrink-0"
                    onClick={() => void controller.requestDraft(detail.id)}
                    disabled={controller.pending}
                  >
                    {t('askDraft')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        <div
          className={cn(
            expanded
              ? 'max-md:fixed max-md:inset-0 max-md:z-50 max-md:flex max-md:flex-col max-md:bg-paper dark:max-md:bg-background'
              : 'max-md:hidden',
          )}
        >
        {expanded ? (
          <div className="flex items-center justify-between gap-3 border-b border-ink px-4 py-3 md:hidden dark:border-rule-on-dark">
            <span className="min-w-0 truncate font-serif text-xl text-ink dark:text-foreground">
              {customer}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="shrink-0 font-mono text-[10px] uppercase tracking-meta text-ink-soft dark:text-foreground/70"
            >
              {tCommon('close')}
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-5 border-b border-rule-soft px-5 dark:border-rule-on-dark">
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
            {t('noteTab', { count: noteCount })}
          </button>
          <span
            className={cn(
              'ml-auto inline-flex min-w-0 items-center gap-1.5 truncate font-mono text-[9px] uppercase tracking-meta',
              streaming || drafting || (dirty && canReply)
                ? 'text-cobalt dark:text-cobalt-soft'
                : 'text-ink-mute',
            )}
          >
            {streaming || drafting ? (
              <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" />
            ) : null}
            {composerState}
          </span>
        </div>

        {errBanner}

        {tab === 'reply' ? (
          !isOpen ? (
            <div className="px-5 py-4 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
              {t('readOnlyClosed')}
            </div>
          ) : canReply ? (
            <div className="flex flex-col gap-2.5 p-4 max-md:min-h-0 max-md:flex-1 md:px-5">
              <textarea
                ref={replyBoxRef}
                value={reply}
                readOnly={streaming || drafting}
                onChange={(e) => {
                  setReply(e.target.value);
                  if (err) controller.clearActionError();
                }}
                rows={4}
                placeholder={t('replyPlaceholder', { name: customer })}
                className="w-full resize-none rounded-input border border-rule-soft bg-paper px-3.5 py-3 text-base leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt max-md:min-h-0 max-md:flex-1 md:text-sm dark:border-rule-on-dark dark:bg-card"
              />
              <div className="flex flex-col flex-wrap items-stretch gap-2 md:flex-row md:items-center">
                <Button
                  variant="accent"
                  onClick={sendReply}
                  disabled={controller.pending || streaming || drafting || !reply.trim()}
                  pending={controller.pendingAction === 'send'}
                  className="max-md:h-11"
                >
                  {suggestionId && !dirty ? t('approveSend') : t('sendReply')}
                </Button>
                {suggestionId ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void controller.rejectDraft(detail.id).then(() => {
                        setSuggestionId(null);
                        setReply('');
                      });
                    }}
                    disabled={controller.pending || streaming}
                    className="max-md:h-11"
                  >
                    {t('reject')}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => void controller.release(detail.id)}
                  disabled={controller.pending}
                >
                  {t('release')}
                </Button>
                {dirty ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setReply(draft.body);
                    }}
                  >
                    {t('restoreDraft')}
                  </Button>
                ) : null}
                {canAskDraft ? (
                  <Button
                    variant="ghost"
                    onClick={() => void controller.requestDraft(detail.id)}
                    disabled={controller.pending}
                  >
                    {t('askDraft')}
                  </Button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void controller.closeConv(detail.id)}
                  disabled={controller.pending}
                  className="font-mono text-[9px] uppercase tracking-meta text-ink-soft transition-colors duration-fast hover:text-cobalt md:ml-auto dark:text-foreground/70"
                >
                  {t('closeNoReply')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-wrap items-stretch gap-2.5 p-4 md:flex-row md:items-center md:px-5">
              <Button
                variant="accent"
                onClick={() => void controller.takeOver(detail.id)}
                disabled={controller.pending}
                pending={controller.pendingAction === 'takeOver'}
                className="max-md:h-11"
              >
                {claim ? t('takeOverToReply') : t('claimToReply')} <span aria-hidden>→</span>
              </Button>
              <span className="font-mono text-[9px] uppercase tracking-meta leading-relaxed text-ink-mute">
                {claim
                  ? t('claimGateOther', { name: claimHolderName ?? t('teammate') })
                  : t('claimGateFree')}
              </span>
              {canAskDraft ? (
                <Button
                  variant="ghost"
                  onClick={() => void controller.requestDraft(detail.id)}
                  disabled={controller.pending}
                  className="md:ml-auto"
                >
                  {t('askDraft')}
                </Button>
              ) : null}
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
      </footer>
    </section>
  );
}
