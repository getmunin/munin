'use client';

import { useTranslations } from 'next-intl';
import { Pill, cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import type { QueueItemDto } from './conversation-queue';
import { initialsOf } from '../../lib/initials';
import { customerLabel } from './inbox-helpers';
import { QueueRow, RowTime } from './queue-row';

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
  faded,
  onSelect,
}: {
  item: QueueItemDto;
  active: boolean;
  viewerUserId: string | null;
  faded?: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.queue');
  const age = useRelative();
  const showsAttention = item.status === 'open' && item.needsHumanAttention;

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
      meta={
        item.lastInboundPreview || (
          <span className="italic text-ink-mute/80 dark:text-foreground/40">{t('noMessage')}</span>
        )
      }
      trailing={
        <>
          {item.lastMessageAt ? <RowTime>{age(item.lastMessageAt)}</RowTime> : null}
          <ClaimFace
            claim={item.claim}
            viewerUserId={viewerUserId}
            showUnclaimed={showsAttention}
          />
        </>
      }
    />
  );
}
