'use client';

import { useTranslations } from 'next-intl';
import { Pill, cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import type { QueueItemDto } from './conversation-queue';
import { initialsOf } from '../../lib/initials';
import { customerLabel } from './inbox-helpers';
import { QueueRow, RowNote, RowTime } from './queue-row';

function ClaimFace({
  claim,
  viewerUserId,
  showUnclaimed,
}: {
  claim: QueueItemDto['claim'];
  viewerUserId: string | null;
  showUnclaimed?: boolean;
}) {
  if (!claim) {
    if (!showUnclaimed) return null;
    return (
      <span
        aria-hidden
        className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-ink-mute font-mono text-[10px] text-ink-mute"
      >
        —
      </span>
    );
  }
  const isYou = claim.holderId === viewerUserId;
  return (
    <span
      title={claim.holderName ?? undefined}
      className={cn(
        'flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
        isYou
          ? 'bg-ink text-paper dark:bg-foreground dark:text-background'
          : 'bg-ink-mute text-paper dark:text-ink',
      )}
    >
      {initialsOf(claim.holderName)}
    </span>
  );
}

export function ConversationRow({
  item,
  active,
  viewerUserId,
  drafting,
  faded,
  onSelect,
}: {
  item: QueueItemDto;
  active: boolean;
  viewerUserId: string | null;
  drafting: boolean;
  faded?: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.queue');
  const age = useRelative();
  const showsAttention = item.status === 'open' && item.needsHumanAttention;
  const showNoDraft = showsAttention && !item.hasPendingDraft;

  return (
    <QueueRow
      active={active}
      faded={faded}
      onSelect={onSelect}
      code={
        <Pill tone="ink" marker="none">
          {item.channelType}
        </Pill>
      }
      emphasizeTitle={showsAttention}
      title={`${customerLabel(
        { name: item.customerName, email: item.customerEmail, phone: item.customerPhone },
        t('anonymous'),
      )}${item.subject ? ` — ${item.subject}` : ''}`}
      meta={item.lastInboundPreview || undefined}
      extra={
        <>
          {item.topicName ? (
            <span
              className={cn(
                'mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] font-medium uppercase tracking-meta',
                item.agentMode === 'auto' ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
              )}
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
              {item.topicName} ·{' '}
              {item.agentMode === 'off'
                ? t('modeHuman')
                : item.agentMode === 'auto'
                  ? t('modeAuto')
                  : t('modeManual')}
            </span>
          ) : null}
          {drafting || showNoDraft ? (
            <span className="mt-0.5 truncate font-mono text-[10px] font-medium uppercase tracking-meta text-cobalt dark:text-cobalt-soft">
              {drafting ? t('draftingBadge') : t('noDraftBadge')}
            </span>
          ) : null}
        </>
      }
      trailing={
        <>
          {item.lastMessageAt ? <RowTime>{age(item.lastMessageAt)}</RowTime> : null}
          <ClaimFace
            claim={item.claim}
            viewerUserId={viewerUserId}
            showUnclaimed={showsAttention}
          />
          {item.noteCount > 0 ? <RowNote>{t('noteCount', { count: item.noteCount })}</RowNote> : null}
        </>
      }
    />
  );
}
