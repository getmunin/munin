'use client';

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
  decidedMergePair,
  decidedOutcomeLabel,
  decidedTitle,
} from './review-decided-labels';

function DecisionRecord({ item }: { item: ReviewDecidedItem }) {
  const t = useTranslations('dashboard.console.review');
  const reason = splitDecisionReason(item.reason);
  const bad = item.outcome === 'failed';
  const label = bad ? 'text-alert-bad-ink' : 'text-ink-label dark:text-foreground/70';
  const stamp = new Date(item.at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      className={cn(
        'border-t-[3px] px-5 py-5 md:px-6 md:py-6',
        bad
          ? 'border-alert-bad-border bg-alert-bad'
          : 'border-cobalt bg-cobalt/[0.055] dark:bg-cobalt/10',
      )}
    >
      <p className="max-w-[56ch] text-[16px] leading-[1.55] text-ink dark:text-foreground">
        {t(`decidedSummary.${item.kind}.${item.outcome}`)}
      </p>
      {reason ? (
        <div className="mt-4 flex flex-col items-start gap-2 bg-ink/[0.05] px-4 py-3.5 dark:bg-ink/50">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={cn('font-mono text-[10px] font-medium uppercase tracking-eyebrow', label)}
            >
              {t('decisionReason')}
            </span>
            {reason.code ? (
              <code
                className={cn(
                  'border px-2 py-1 font-mono text-[11.5px] leading-none',
                  bad
                    ? 'border-alert-bad-border/60 text-alert-bad-ink'
                    : 'border-ink/20 text-ink-soft dark:border-rule-on-dark dark:text-foreground/80',
                )}
              >
                {reason.code}
              </code>
            ) : null}
          </div>
          <p
            className={
              reason.code
                ? 'whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-ink-soft dark:text-foreground/80'
                : 'max-w-[62ch] whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink-soft dark:text-foreground/80'
            }
          >
            {reason.message}
          </p>
        </div>
      ) : null}
      <div className="mt-4 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
        {stamp}
      </div>
    </div>
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
  const mergePair = decidedMergePair(item);

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-paper dark:bg-background">
      <div className="flex flex-1 flex-col gap-5 px-5 pb-8 pt-6 md:px-7">
        <div className="flex flex-col gap-2.5">
          <div
            className={cn(
              'font-mono text-[10px] font-medium uppercase tracking-eyebrow',
              item.outcome === 'failed'
                ? 'text-alert-bad-ink'
                : 'text-cobalt dark:text-cobalt-soft',
            )}
          >
            {decidedOutcomeLabel(item, t)}
          </div>
          <h2 className="max-w-[42ch] font-serif text-[26px] font-normal leading-[1.2] text-ink md:text-[30px] dark:text-foreground">
            {mergePair ? (
              <>
                {mergePair[0]}
                <MetaArrow
                  glyph="↔"
                  className="mx-2 inline size-[0.5em] align-middle text-ink-mute"
                />
                {mergePair[1]}
              </>
            ) : (
              decidedTitle(item, t)
            )}
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

        <DecisionRecord item={item} />

        <div className="flex flex-col gap-5">
          <ReviewDecidedContent item={item} controller={controller} />
        </div>
      </div>
    </section>
  );
}
