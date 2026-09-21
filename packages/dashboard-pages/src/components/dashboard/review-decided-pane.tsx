'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { Link } from '../../i18n-navigation';
import { useRelative } from '../../lib/use-relative';
import { splitDecisionReason } from './decision-reason';
import { MetaArrow } from './meta-arrow';
import { ReviewDecidedContent } from './review-decided-content';
import type { ReviewDecidedController, ReviewDecidedItem } from './review-decided';
import {
  decidedConversationId,
  decidedOutcomeLabel,
  decidedTitle,
} from './review-decided-labels';

function DecisionRecord({ item }: { item: ReviewDecidedItem }) {
  const t = useTranslations('dashboard.console.review');
  const [reasonOpen, setReasonOpen] = useState(false);
  const reason = splitDecisionReason(item.reason);
  const bad = item.outcome === 'failed';
  const accent = bad ? 'text-alert-bad-ink' : 'text-cobalt dark:text-cobalt-soft';
  const stamp = new Date(item.at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const frame = cn(
    'flex w-full flex-wrap items-start gap-x-4 gap-y-1 border-l-2 px-3 py-2',
    bad ? 'border-alert-bad-border bg-alert-bad' : 'border-cobalt bg-cobalt/[0.06] dark:bg-cobalt/10',
  );

  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn('font-mono text-[10px] font-medium uppercase tracking-eyebrow', accent)}
        >
          {t('decisionRecordLabel')}
        </span>
        <span className="text-[13px] leading-relaxed text-ink dark:text-foreground">
          {t(`decidedSummary.${item.kind}.${item.outcome}`)}
        </span>
        {reason && reasonOpen ? (
          <span className="mt-1 flex flex-col gap-1">
            <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label dark:text-foreground/70">
              {t('decisionReason')}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">
              {reason.code ? (
                <code
                  className={cn(
                    'font-mono text-[11.5px]',
                    bad ? 'text-alert-bad-ink' : 'text-ink-mute dark:text-foreground/60',
                  )}
                >
                  {reason.code}
                </code>
              ) : null}
              <span className="min-w-0 whitespace-pre-wrap break-words">{reason.message}</span>
            </span>
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
        {stamp}
        {reason ? (
          <MetaArrow
            glyph={reasonOpen ? '↑' : '↓'}
            className={cn('transition-colors duration-fast group-hover:text-ink', accent)}
          />
        ) : null}
      </span>
    </>
  );

  if (!reason) return <div className={frame}>{content}</div>;

  return (
    <button
      type="button"
      onClick={() => setReasonOpen((open) => !open)}
      aria-expanded={reasonOpen}
      className={cn(
        frame,
        'group text-left transition-colors duration-fast',
        bad ? 'hover:bg-alert-bad-border/25' : 'hover:bg-cobalt/[0.12] dark:hover:bg-cobalt/20',
      )}
    >
      {content}
    </button>
  );
}

export function ReviewDecidedPane({
  item,
  controller,
}: {
  item: ReviewDecidedItem | undefined;
  controller: ReviewDecidedController;
}) {
  const t = useTranslations('dashboard.console.review');
  const age = useRelative();

  if (!item) {
    return <section className="hidden min-h-0 flex-col bg-paper-deep md:flex dark:bg-secondary" />;
  }

  const decidedBy =
    item.decidedBy.actorType === 'user'
      ? (item.decidedBy.name ?? t('decidedByUnknown'))
      : t('decidedByAgent');
  const conversationId = decidedConversationId(item);

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-paper dark:bg-background">
      <div className="flex flex-1 flex-col gap-5 px-5 pb-8 pt-6 md:px-7">
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {decidedOutcomeLabel(item, t)}
          </div>
          <h2 className="max-w-[42ch] font-serif text-[26px] font-normal leading-[1.2] text-ink md:text-[30px] dark:text-foreground">
            {decidedTitle(item, t)}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
            <span>{decidedBy}</span>
            <span aria-hidden>·</span>
            <span>{age(item.at)}</span>
            {conversationId ? (
              <>
                <span aria-hidden>·</span>
                <Link
                  href={`/dashboard/conversations/${conversationId}`}
                  className="underline underline-offset-[3px] text-ink-soft transition-colors duration-fast hover:text-ink dark:text-foreground/70 dark:hover:text-foreground"
                >
                  {t('sourceConversation')}
                </Link>
              </>
            ) : null}
          </div>
        </div>

        <DecisionRecord key={item.id} item={item} />

        <div className="flex flex-col gap-5">
          <ReviewDecidedContent item={item} controller={controller} />
        </div>
      </div>
    </section>
  );
}
