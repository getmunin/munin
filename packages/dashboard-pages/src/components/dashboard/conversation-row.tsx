'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import type { QueueItemDto } from './conversation-queue';
import { initialsOf } from '../../lib/initials';

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
        className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-ink-mute font-mono text-[9px] text-ink-mute"
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
        'flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[8px]',
        isYou
          ? 'bg-ink text-paper dark:bg-foreground dark:text-background'
          : 'bg-ink-mute text-ink',
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
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'grid cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-3.5 border-b border-rule-soft px-5 py-3.5 transition-[background-color,opacity] duration-fast ease-munin dark:border-rule-on-dark',
          faded && !active && 'opacity-[var(--qfade,0.55)]',
          active
            ? 'border-l-2 border-l-cobalt bg-paper-deep pl-[18px] dark:border-l-cobalt-soft dark:bg-card'
            : 'hover:bg-paper-deep hover:!opacity-100 dark:hover:bg-card',
        )}
      >
        <span className="inline-flex min-w-[44px] self-center justify-center border border-rule-soft bg-paper-deep px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink dark:border-rule-on-dark dark:bg-secondary dark:text-foreground">
          {item.channelType}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              'truncate text-sm text-ink dark:text-foreground',
              showsAttention && 'font-medium',
            )}
          >
            {item.customerName ?? item.customerEmail ?? t('anonymous')}
            {item.subject ? ` — ${item.subject}` : ''}
          </span>
          {item.lastInboundPreview ? (
            <span className="truncate text-[13px] text-ink-soft dark:text-foreground/70">
              {item.lastInboundPreview}
            </span>
          ) : null}
          {item.topicName ? (
            <span
              className={cn(
                'mt-0.5 flex items-center gap-1.5 truncate font-mono text-[9px] uppercase tracking-meta',
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
          {drafting ? (
            <span className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-meta text-cobalt dark:text-cobalt-soft">
              {t('draftingBadge')}
            </span>
          ) : showNoDraft ? (
            <span className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-meta text-cobalt dark:text-cobalt-soft">
              {t('noDraftBadge')}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-[56px] flex-col items-end gap-1.5">
          {item.lastMessageAt ? (
            <span className="font-mono text-[10px] text-ink-mute">{age(item.lastMessageAt)}</span>
          ) : null}
          <ClaimFace
            claim={item.claim}
            viewerUserId={viewerUserId}
            showUnclaimed={showsAttention}
          />
          {item.noteCount > 0 ? (
            <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-meta text-ink-mute">
              {t('noteCount', { count: item.noteCount })}
            </span>
          ) : null}
        </span>
      </div>
    </li>
  );
}
