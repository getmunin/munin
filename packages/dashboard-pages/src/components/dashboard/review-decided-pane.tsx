'use client';

import { useTranslations } from 'next-intl';
import { Link } from '../../i18n-navigation';
import { useRelative } from '../../lib/use-relative';
import { DecidedSection, ReviewDecidedContent } from './review-decided-content';
import type { ReviewDecidedController, ReviewDecidedItem } from './review-decided';
import {
  decidedConversationId,
  decidedOutcomeLabel,
  decidedTitle,
} from './review-decided-labels';

function Prose({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <p
      className={
        muted
          ? 'max-w-[62ch] text-[14.5px] leading-relaxed text-ink-soft dark:text-foreground/70'
          : 'max-w-[62ch] text-[14.5px] leading-relaxed text-ink dark:text-foreground'
      }
    >
      {children}
    </p>
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

        <div className="flex flex-col gap-5 border-t border-rule-soft pt-5 dark:border-rule-on-dark">
          {item.reason ? (
            <DecidedSection label={t('decisionReason')}>
              <Prose>{item.reason}</Prose>
            </DecidedSection>
          ) : null}

          <DecidedSection label={t('decisionRecordLabel')}>
            <Prose muted>{t(`decidedSummary.${item.kind}.${item.outcome}`)}</Prose>
          </DecidedSection>

          <ReviewDecidedContent item={item} controller={controller} />
        </div>
      </div>
    </section>
  );
}
