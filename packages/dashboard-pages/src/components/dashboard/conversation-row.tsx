'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import type { QueueRowModel } from './conversation-queue';

export interface ConversationRowProps {
  row: QueueRowModel;
  active?: boolean;
  viewerUserId: string | null;
  viewerName?: string | null;
  assigneeName?: string | null;
  onOpen: () => void;
}

export function ConversationRow({
  row,
  active,
  viewerUserId,
  viewerName,
  assigneeName,
  onOpen,
}: ConversationRowProps) {
  const t = useTranslations('dashboard.conversations');
  const tDrawer = useTranslations('dashboard.overview.drawer');
  const age = useRelative();

  const claimedByViewer = row.assigneeUserId != null && row.assigneeUserId === viewerUserId;
  const who = row.who ?? tDrawer('endUserFallback');
  const subject = row.subject ?? tDrawer('conversationFallback', { id: row.displayId });

  return (
    <li className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          'flex cursor-pointer flex-col gap-1.5 py-3.5 pl-3 pr-1 transition-colors duration-fast ease-munin',
          active
            ? 'border-l-2 border-l-cobalt bg-paper-deep pl-2.5 dark:bg-secondary'
            : 'border-l-2 border-l-transparent hover:bg-paper-deep dark:hover:bg-secondary',
        )}
      >
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
          {row.needsHumanAttention ? (
            <span
              aria-hidden
              className="size-[7px] shrink-0 rounded-full bg-cobalt shadow-[0_0_0_3px_rgb(var(--munin-accent)/0.22)] dark:bg-cobalt-soft"
            />
          ) : null}
          <span className="truncate">{row.channelType ?? t('channelFallback')}</span>
          <span className="ml-auto shrink-0 text-ink dark:text-foreground">{age(row.at)}</span>
        </span>

        <span
          className={cn(
            'text-[15px] leading-snug text-ink [text-wrap:pretty] dark:text-foreground',
            row.needsHumanAttention && 'font-medium',
          )}
        >
          {who} — {subject}
        </span>

        {row.preview ? (
          <span className="line-clamp-2 text-[13px] leading-snug text-ink-mute dark:text-foreground/55">
            {row.preview}
          </span>
        ) : null}

        <span className="mt-0.5 flex items-center gap-2">
          <ClaimAvatar
            claimedByViewer={claimedByViewer}
            assigned={row.assigneeUserId != null}
            name={(claimedByViewer ? viewerName : assigneeName) ?? null}
          />
          <span className="truncate font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
            {row.assigneeUserId == null
              ? t('unclaimed')
              : claimedByViewer
                ? t('claimedByYou')
                : assigneeName
                  ? t('claimedBy', { who: assigneeName })
                  : t('claimed')}
          </span>
        </span>
      </div>
    </li>
  );
}

function ClaimAvatar({
  claimedByViewer,
  assigned,
  name,
}: {
  claimedByViewer: boolean;
  assigned: boolean;
  name: string | null;
}) {
  if (!assigned) {
    return (
      <span
        aria-hidden
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-ink-mute font-mono text-[9px] text-ink-mute"
      >
        —
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[8px] text-paper',
        claimedByViewer ? 'bg-cobalt' : 'bg-ink dark:bg-foreground dark:text-background',
      )}
    >
      {rowInitials(name)}
    </span>
  );
}

function rowInitials(name: string | null): string {
  if (!name) return '·';
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}
