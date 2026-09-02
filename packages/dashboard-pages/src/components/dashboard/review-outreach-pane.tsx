'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, BodyDiff, Pill, cn } from '@getmunin/ui';
import { diffLines } from '@getmunin/types';
import { useRelative } from '../../lib/use-relative';
import { Markdown, ModuleGlyph, toDateTimeLocalValue, useCmdEnter } from './queue-drawers/shared';
import { readOutreachEvidence, type OutreachProposalDto } from './queue-drawers/types';
import type { QueueActionError } from './inbox-types';
import { QueueActionErrorBanner } from './queue-action-error';

export type OutreachQueueItem = {
  id: string;
  title: string;
  snippet: string;
  createdAt: string;
  raw: OutreachProposalDto;
};

const SMS_SEGMENT_LENGTH = 160;

type SendChoice = 'proposed' | 'now' | 'pick';

export function ReviewOutreachPane({
  item,
  evidence,
  pending,
  actionError,
  onClearActionError,
  onApprove,
  onDismiss,
  onSave,
}: {
  item: OutreachQueueItem;
  evidence: Record<string, unknown> | undefined;
  pending: boolean;
  actionError: QueueActionError;
  onClearActionError: () => void;
  onApprove: (sendAt?: string | null) => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
}) {
  const t = useTranslations('dashboard.console.review.outreach');
  const age = useRelative();
  const format = useFormatter();

  const proposal = item.raw;
  const initialBody = proposal.draftBody;
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(initialBody);
  const [choice, setChoice] = useState<SendChoice>('proposed');
  const [pickedAt, setPickedAt] = useState('');
  const [diffOpen, setDiffOpen] = useState(false);
  const diffRef = useRef<HTMLDivElement>(null);

  const proposedSendAt = useMemo(() => futureDate(proposal.proposedSendAt), [proposal.proposedSendAt]);

  useEffect(() => {
    setEditing(false);
    setEditedBody(initialBody);
    setChoice(futureDate(proposal.proposedSendAt) ? 'proposed' : 'now');
    setPickedAt('');
    setDiffOpen(false);
  }, [item.id, initialBody, proposal.proposedSendAt]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditedBody(initialBody);
  }, [initialBody]);

  const saveEdit = useCallback(async () => {
    if (!editedBody.trim() || pending) return;
    await onSave(editedBody);
    setEditing(false);
  }, [editedBody, pending, onSave]);

  const channelType = proposal.delivery?.channelType ?? 'email';
  const isEmail = channelType === 'email';
  const isVoice = channelType === 'voice';

  const approve = useCallback(() => {
    if (choice === 'now') {
      onApprove(proposedSendAt ? null : undefined);
      return;
    }
    if (choice === 'proposed') {
      onApprove(proposedSendAt ? proposedSendAt.toISOString() : undefined);
      return;
    }
    const at = new Date(pickedAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return;
    onApprove(at.toISOString());
  }, [choice, proposedSendAt, pickedAt, onApprove]);

  useCmdEnter(() => {
    if (pending) return;
    if (editing) void saveEdit();
    else approve();
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

  const editCount = useMemo(
    () => countEdits(proposal.originalDraftBody, editedBody),
    [proposal.originalDraftBody, editedBody],
  );
  const revealDiff = useCallback(() => {
    setDiffOpen(true);
    requestAnimationFrame(() =>
      diffRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }, []);

  const parsedEvidence = useMemo(() => readOutreachEvidence(evidence), [evidence]);
  const stamp = (d: Date) =>
    format.dateTime(d, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const timeOnly = (d: Date) => format.dateTime(d, { hour: '2-digit', minute: '2-digit' });

  const destination = proposal.delivery?.destination ?? null;
  const contactName = proposal.contact?.name ?? null;
  const companyName = proposal.contact?.companyName ?? null;
  const appendsCta = proposal.delivery?.appendsCta === true;
  const appendsUnsubscribe = proposal.delivery?.appendsUnsubscribe === true;
  const ctaUrl = proposal.campaign?.ctaUrl ?? null;
  const kindLabel =
    proposal.kind === 'reply'
      ? t('kindReply')
      : proposal.kind === 'followup'
        ? t('kindFollowup', { step: proposal.sequenceStep ?? 1 })
        : t('kindInitial');
  const segments = Math.max(1, Math.ceil(editedBody.length / SMS_SEGMENT_LENGTH));
  const pickInvalid =
    choice === 'pick' &&
    (!pickedAt || Number.isNaN(new Date(pickedAt).getTime()) || new Date(pickedAt) <= new Date());

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-paper dark:bg-background">
      <div className="flex flex-1 flex-col gap-5 px-5 pb-8 pt-6 md:px-7">
        <header className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="out" marker="none">
              <ModuleGlyph kind="outreach" className="size-[7px]" />
              {t('eyebrow')}
            </Pill>
            <span className="bg-ink px-[6px] py-[3px] font-mono text-[9px] uppercase tracking-eyebrow text-paper dark:bg-foreground dark:text-background">
              {t(`channel_${channelType}` as 'channel_email')}
            </span>
            <span className="border border-rule-soft px-[6px] py-[3px] font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:border-rule-on-dark">
              {kindLabel}
            </span>
            <span className="ml-auto font-mono text-[9px] uppercase tracking-meta text-ink-mute">
              {proposal.campaign?.name ?? t('campaignUnknown')} · {age(item.createdAt)}
            </span>
          </div>
          <h2 className="font-serif text-[26px] font-normal leading-[1.1] tracking-tight text-ink md:text-[29px] dark:text-foreground">
            {contactName ?? t('contactUnknown')}
            {companyName ? (
              <>
                <span aria-hidden className="px-1.5 text-ink-mute">
                  ·
                </span>
                {companyName}
              </>
            ) : null}
          </h2>
          {destination ? (
            <span className="font-mono text-[10.5px] tracking-meta text-ink dark:text-foreground">
              {destination}
            </span>
          ) : (
            <span className="border-l-2 border-alert-bad-border py-1 pl-3 text-[13px] leading-relaxed text-alert-bad-ink">
              {t(isEmail ? 'noEmail' : 'noPhone')}
            </span>
          )}
        </header>

        {proposal.revisedAfterReviewAt ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-alert-bad-border bg-alert-bad px-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-alert-bad-ink">
                {t('revisedAfterReview')}
              </span>
              <span className="text-[13px] leading-relaxed text-ink dark:text-foreground">
                {proposal.lastRevisionReason
                  ? t('revisedReason', { reason: proposal.lastRevisionReason })
                  : t('revisedNoReason')}
              </span>
            </span>
            {editCount > 0 ? (
              <button
                type="button"
                onClick={revealDiff}
                className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-cobalt underline-offset-[3px] hover:underline dark:text-cobalt-soft"
              >
                {t('seeDiff')} <span aria-hidden>→</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="border border-ink dark:border-rule-on-dark">
          {isEmail ? (
            <div className="grid grid-cols-[54px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-rule-soft bg-paper-deep px-4 py-3 dark:border-rule-on-dark dark:bg-secondary">
              <EnvelopeLabel>{t('from')}</EnvelopeLabel>
              <span className="text-[12.5px] text-ink dark:text-foreground">
                {[proposal.delivery?.senderName, proposal.delivery?.sender]
                  .filter(Boolean)
                  .join(' · ') || t('senderUnknown')}
              </span>
              <EnvelopeLabel>{t('to')}</EnvelopeLabel>
              <span className="text-[12.5px] text-ink dark:text-foreground">
                {[contactName, destination].filter(Boolean).join(' · ') || t('contactUnknown')}
              </span>
              {proposal.draftSubject ? (
                <>
                  <EnvelopeLabel>{t('subject')}</EnvelopeLabel>
                  <span className="text-[12.5px] font-medium text-ink dark:text-foreground">
                    {proposal.draftSubject}
                  </span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-3 border-b border-rule-soft bg-paper-deep px-4 py-2.5 dark:border-rule-on-dark dark:bg-secondary">
              <EnvelopeLabel>{isVoice ? t('callsFrom') : t('textsFrom')}</EnvelopeLabel>
              <span className="text-[12.5px] text-ink dark:text-foreground">
                {proposal.delivery?.sender ?? t('senderUnknown')}
              </span>
              {!isVoice ? (
                <span className="ml-auto font-mono text-[9px] uppercase tracking-meta text-ink-mute">
                  {t('smsSegments', { count: segments, chars: editedBody.length })}
                </span>
              ) : null}
            </div>
          )}

          {editing ? (
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={14}
              autoFocus
              className="w-full resize-y bg-paper px-5 py-4 text-[14.5px] leading-relaxed text-ink outline-none dark:bg-card dark:text-foreground"
            />
          ) : (
            <div className="flex flex-col gap-3 bg-bone px-5 py-5 text-[14.5px] leading-[1.7] text-ink dark:bg-secondary dark:text-foreground">
              <Markdown>{editedBody}</Markdown>
              {appendsCta || appendsUnsubscribe ? (
                <div className="mt-1 flex flex-col gap-2 border-t border-dashed border-ink-mute pt-3">
                  <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute">
                    {t('appendedOnSend')}
                  </span>
                  {appendsCta ? (
                    <span className="break-all font-mono text-[12.5px] text-ink-soft dark:text-foreground/70">
                      {ctaUrl ?? t('ctaUrlUnknown')}
                    </span>
                  ) : null}
                  {appendsUnsubscribe ? (
                    <>
                      <span aria-hidden className="font-mono text-[12.5px] text-ink-mute">
                        ---
                      </span>
                      <span className="text-[13px] text-ink-soft underline underline-offset-[3px] dark:text-foreground/70">
                        {t('unsubscribeWord')}
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {!editing && proposal.originalDraftBody && editCount > 0 ? (
          <div ref={diffRef} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setDiffOpen((open) => !open)}
              aria-expanded={diffOpen}
              className="flex items-baseline justify-between gap-4 border-t border-rule-soft pt-3 text-left font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute transition-colors duration-fast hover:text-ink dark:border-rule-on-dark dark:hover:text-foreground"
            >
              <span>{t('diffSummary', { count: editCount })}</span>
              <span className="shrink-0 text-cobalt dark:text-cobalt-soft">
                {diffOpen ? t('diffHide') : t('diffShow')}
              </span>
            </button>
            {diffOpen ? (
              <BodyDiff
                before={proposal.originalDraftBody}
                after={editedBody}
                unchangedLabel={t('originalDraftUnchanged')}
                wrap
              />
            ) : null}
          </div>
        ) : null}

        {parsedEvidence ? (
          <div className="flex flex-col gap-2.5 border-t border-ink pt-4 dark:border-rule-on-dark">
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
              {t('whyThis')}
            </span>
            {parsedEvidence.prose.map((line) => (
              <p
                key={line}
                className="max-w-[62ch] text-[14px] leading-relaxed text-ink dark:text-foreground"
              >
                {line}
              </p>
            ))}
            {parsedEvidence.kbRefs.length > 0 || parsedEvidence.chips.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {parsedEvidence.kbRefs.map((ref) => (
                  <span
                    key={ref}
                    className="border border-rule-soft px-2 py-[3px] font-mono text-[9px] tracking-meta text-ink-soft dark:border-rule-on-dark dark:text-foreground/70"
                  >
                    {t('kbChip', { id: ref.replace(/^kb:\/\//, '') })}
                  </span>
                ))}
                {parsedEvidence.chips.map((chip) => (
                  <span
                    key={`${chip.label}-${chip.value}`}
                    className="border border-rule-soft px-2 py-[3px] font-mono text-[9px] tracking-meta text-ink-soft dark:border-rule-on-dark dark:text-foreground/70"
                  >
                    {chip.label} = {chip.value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!editing ? (
          <div className="flex flex-col gap-2.5 border-t border-ink pt-4 dark:border-rule-on-dark">
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
              {t('whenItGoes')}
            </span>
            <div className="flex flex-col border border-rule-soft dark:border-rule-on-dark">
              {proposedSendAt ? (
                <SendOption
                  selected={choice === 'proposed'}
                  onSelect={() => setChoice('proposed')}
                  label={t('sendProposed', { when: stamp(proposedSendAt) })}
                />
              ) : null}
              <SendOption
                selected={choice === 'now'}
                onSelect={() => setChoice('now')}
                label={t('sendNow', { when: timeOnly(new Date()) })}
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
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule-soft pt-3 font-mono text-[9.5px] uppercase tracking-meta text-ink-mute dark:border-rule-on-dark">
          <span>
            {proposal.proposedByActorType === 'user' ? t('draftedByUser') : t('draftedByAgent')} ·{' '}
            {age(item.createdAt)}
          </span>
          {proposal.firstViewedAt ? <span>{t('readAt', { when: age(proposal.firstViewedAt) })}</span> : null}
          {proposal.revisionCount ? (
            <span>{t('revisionCount', { count: proposal.revisionCount })}</span>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-rule-soft bg-paper dark:border-rule-on-dark dark:bg-background">
        <QueueActionErrorBanner
          error={actionError?.itemId === item.id ? actionError : null}
          onDismiss={onClearActionError}
        />
        <div className="flex flex-col flex-wrap items-stretch gap-2 p-4 md:flex-row md:items-center md:px-5">
          {editing ? (
            <>
              <Button
                variant="accent"
                disabled={pending || !editedBody.trim()}
                onClick={() => void saveEdit()}
                className="max-md:h-11"
              >
                {t('save')}
              </Button>
              <Button variant="ghost" onClick={cancelEdit} className="max-md:h-11">
                {t('cancel')}
              </Button>
              <span className="hidden font-mono text-[9px] uppercase tracking-meta text-ink-mute md:ml-auto md:inline">
                {t('shortcutSave')}
              </span>
            </>
          ) : (
            <>
              <Button
                variant="accent"
                disabled={pending || !destination || pickInvalid}
                onClick={approve}
                className="max-md:h-11"
              >
                {approveLabel(choice, proposedSendAt, t, stamp)} <span aria-hidden>→</span>
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setEditing(true)}
                className="max-md:h-11"
              >
                {t('edit')}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={onDismiss}
                className="max-md:h-11"
              >
                {t('dismiss')}
              </Button>
              <span className="hidden font-mono text-[9px] uppercase tracking-meta text-ink-mute md:ml-auto md:inline">
                {t('shortcutApprove')}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function approveLabel(
  choice: SendChoice,
  proposedSendAt: Date | null,
  t: (key: string, values?: Record<string, string>) => string,
  stamp: (d: Date) => string,
): string {
  if (choice === 'proposed' && proposedSendAt) {
    return t('approveScheduled', { when: stamp(proposedSendAt) });
  }
  if (choice === 'pick') return t('approveScheduledPicked');
  return t('approveNow');
}

function EnvelopeLabel({ children }: { children: string }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute">{children}</span>
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
          'shrink-0 text-[13.5px] text-ink dark:text-foreground',
          !selected && 'text-ink-soft dark:text-foreground/70',
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function countEdits(before: string | null | undefined, after: string): number {
  if (!before) return 0;
  let edits = 0;
  let inEdit = false;
  for (const line of diffLines(before, after)) {
    const changed = line.op !== 'context';
    if (changed && !inEdit) edits += 1;
    inEdit = changed;
  }
  return edits;
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
