'use client';

import { useEffect, useRef, useState } from 'react';
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

function WhyBlock({ draft }: { draft: MessageDto }) {
  const t = useTranslations('dashboard.console.queue');
  const age = useRelative();
  const [open, setOpen] = useState(false);
  const rationale = draft.metadata['rationale'];
  const toolNames = draft.metadata['toolNames'];
  const tools = Array.isArray(toolNames)
    ? toolNames.filter((v): v is string => typeof v === 'string')
    : [];
  if (typeof rationale !== 'string' && tools.length === 0) return null;

  return (
    <div className="ml-12 flex flex-col gap-1 border-l-2 border-cobalt bg-paper px-3.5 py-2.5 dark:border-cobalt-soft dark:bg-card">
      <span className="flex items-baseline gap-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[9px] uppercase tracking-meta text-cobalt dark:text-cobalt-soft">
          {t('agentLine', { age: age(draft.createdAt) })}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 font-mono text-[9px] uppercase tracking-meta text-cobalt dark:text-cobalt-soft"
        >
          {open ? t('whyHide') : t('whyShow')}
        </button>
      </span>
      <span className="text-[13px] leading-relaxed text-ink dark:text-foreground">
        {t('agentDrafted', { tools: tools.length })}
      </span>
      {open ? (
        <span className="mt-1 flex flex-col gap-2 border-t border-rule-soft pt-2 dark:border-rule-on-dark">
          {typeof rationale === 'string' ? (
            <span className="text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">
              {rationale}
            </span>
          ) : null}
          {tools.length > 0 ? (
            <span className="flex flex-wrap gap-2">
              {tools.map((name) => (
                <span
                  key={name}
                  className="border border-rule-soft px-2 py-1 font-mono text-[9px] uppercase tracking-meta text-ink-soft dark:border-rule-on-dark dark:text-foreground/80"
                >
                  {name}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
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
  const seededDraftId = useRef<string | null>(null);

  const draft = pendingDraftOf(detail);

  useEffect(() => {
    seededDraftId.current = null;
    setSuggestionId(null);
    setReply('');
    setNoteDraft('');
    setTab('reply');
  }, [selectedId]);

  useEffect(() => {
    if (!draft || seededDraftId.current === draft.id) return;
    seededDraftId.current = draft.id;
    setSuggestionId(draft.id);
    setReply(draft.body);
  }, [draft]);

  useEffect(() => {
    if (suggestionId && draft?.id !== suggestionId) setSuggestionId(null);
  }, [draft, suggestionId]);

  const thread = detail?.messages.filter((m) => messageDraftKind(m) === null) ?? [];
  const noteCount = thread.filter(isNoteMessage).length;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = thread[thread.length - 1]?.id;
  const draftingSelected = selectedId ? !!controller.draftRequested[selectedId] : false;
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, lastMessageId, thread.length, draftingSelected]);

  const sendReply = (): void => {
    if (!selectedId || !reply.trim() || controller.pending) return;
    void controller.send(selectedId, reply, suggestionId ?? undefined).then((ok) => {
      if (ok) setReply('');
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
  const dirty = !!draft && suggestionId !== null && reply !== draft.body;
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
    : drafting
      ? t('stateDrafting')
      : !claim
        ? t('stateUnclaimed')
        : !claimMine
          ? t('stateOwnedBy', { name: claimHolderName ?? t('teammate') })
          : dirty
            ? t('stateEdited')
            : draft
              ? t('stateDraftReady')
              : t('stateNoDraft');

  return (
    <section className="flex min-h-0 flex-col bg-paper-deep dark:bg-secondary">
      <header className="shrink-0 border-b border-ink bg-paper px-5 pb-4 pt-5 md:px-7 dark:border-rule-on-dark dark:bg-background">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-soft md:hidden dark:text-foreground/80"
        >
          <ArrowLeft aria-hidden className="size-4" /> {t('backToQueue')}
        </button>
        <div className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
          {item?.topicName ?? channelType} · #{detail.displayId}
        </div>
        <h2 className="mt-1.5 truncate font-serif text-2xl font-normal leading-tight tracking-tight text-ink md:text-[28px] dark:text-foreground">
          {detail.subject ?? customer}
        </h2>
        <div className="mt-1.5 flex min-w-0 gap-2 truncate text-xs text-ink-mute">
          <span className="shrink-0">
            {t('toCustomer', { name: customer })}
          </span>
          {channelType ? <span aria-hidden>·</span> : null}
          {channelType ? <span className="shrink-0">{t('viaChannel', { channel: channelType })}</span> : null}
          <span aria-hidden>·</span>
          <span className="truncate">{originLine}</span>
        </div>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5 md:px-7">
        {thread.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {draft ? <WhyBlock draft={draft} /> : null}
        {drafting ? (
          <div className="ml-12 flex items-center gap-2.5 border-l-2 border-cobalt bg-paper px-3.5 py-3 dark:border-cobalt-soft dark:bg-card">
            <span aria-hidden className="flex gap-1">
              <span className="size-1.5 animate-pulse rounded-full bg-cobalt dark:bg-cobalt-soft" />
              <span className="size-1.5 animate-pulse rounded-full bg-cobalt [animation-delay:200ms] dark:bg-cobalt-soft" />
              <span className="size-1.5 animate-pulse rounded-full bg-cobalt [animation-delay:400ms] dark:bg-cobalt-soft" />
            </span>
            <span className="font-mono text-[9px] uppercase tracking-meta text-cobalt dark:text-cobalt-soft">
              {t('draftingThread')}
            </span>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-ink bg-paper dark:border-rule-on-dark dark:bg-background">
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
              'ml-auto min-w-0 truncate font-mono text-[9px] uppercase tracking-meta',
              dirty && canReply ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
            )}
          >
            {composerState}
          </span>
        </div>

        {err ? (
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
        ) : null}

        {tab === 'reply' ? (
          !isOpen ? (
            <div className="px-5 py-4 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
              {t('readOnlyClosed')}
            </div>
          ) : canReply ? (
            <div className="flex flex-col gap-2.5 p-4 md:px-5">
              <textarea
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  if (err) controller.clearActionError();
                }}
                rows={suggestionId ? 7 : 4}
                placeholder={t('replyPlaceholder', { name: customer })}
                className="w-full rounded-input border border-rule-soft bg-paper px-3.5 py-3 text-base leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt md:text-sm dark:border-rule-on-dark dark:bg-card"
              />
              <div className="flex flex-col flex-wrap items-stretch gap-2 md:flex-row md:items-center">
                <Button
                  variant="accent"
                  onClick={sendReply}
                  disabled={controller.pending || !reply.trim()}
                  pending={controller.pending}
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
                    disabled={controller.pending}
                    className="max-md:h-11"
                  >
                    {t('reject')}
                  </Button>
                ) : null}
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
                <Button
                  variant="outline"
                  onClick={() => void controller.release(detail.id)}
                  disabled={controller.pending}
                >
                  {t('release')}
                </Button>
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
                pending={controller.pending}
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
          <div className="flex flex-col gap-2.5 p-4 md:px-5">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={4}
              placeholder={t('notePlaceholder')}
              className="w-full rounded-input border border-amber-200 bg-amber-50 px-3.5 py-3 text-base leading-relaxed outline-none focus-visible:border-amber-500 focus-visible:ring-1 focus-visible:ring-amber-500 md:text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
            />
            <div className="flex flex-col items-stretch gap-2.5 md:flex-row md:items-center">
              <Button
                onClick={() => {
                  if (!noteDraft.trim() || controller.pending) return;
                  void controller.addNote(detail.id, noteDraft).then((ok) => {
                    if (ok) setNoteDraft('');
                  });
                }}
                disabled={controller.pending || !noteDraft.trim()}
                pending={controller.pending}
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
      </footer>
    </section>
  );
}
