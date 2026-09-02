'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { PageSpinner } from '@getmunin/ui';
import { Link } from '../../i18n-navigation';
import { useRelative } from '../../lib/use-relative';
import { Markdown } from './queue-drawers/shared';
import type { CurationDecisionDto, PublishedDocument } from './curation-decisions';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">{label}</div>
      {children}
    </div>
  );
}

export function ReviewDecidedPane({
  item,
  publishedDoc,
  publishedDocFailed,
  onLoadPublishedDoc,
}: {
  item: CurationDecisionDto | undefined;
  publishedDoc: PublishedDocument | undefined;
  publishedDocFailed: boolean;
  onLoadPublishedDoc: (id: string) => void;
}) {
  const t = useTranslations('dashboard.console.review');
  const age = useRelative();

  const publishedId = item?.outcome === 'published' ? item.publishedDocumentId : null;
  useEffect(() => {
    if (!publishedId) return;
    if (publishedDoc || publishedDocFailed) return;
    onLoadPublishedDoc(publishedId);
  }, [publishedId, publishedDoc, publishedDocFailed, onLoadPublishedDoc]);

  if (!item) {
    return <section className="hidden min-h-0 flex-col bg-paper-deep md:flex dark:bg-secondary" />;
  }

  const published = item.outcome === 'published';
  const decidedBy =
    item.decidedByActorType === 'user'
      ? (item.decidedByName ?? t('decidedByUnknown'))
      : t('decidedByAgent');

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-paper dark:bg-background">
      <div className="flex flex-1 flex-col gap-5 px-5 pb-8 pt-6 md:px-7">
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {published ? t('outcomePublished') : t('outcomeDismissed')}
          </div>
          <h2 className="max-w-[42ch] font-serif text-[26px] font-normal leading-[1.2] text-ink md:text-[30px] dark:text-foreground">
            {item.title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
            <span>{decidedBy}</span>
            <span aria-hidden>·</span>
            <span>{age(item.decidedAt)}</span>
            {item.sourceConversationId ? (
              <>
                <span aria-hidden>·</span>
                <Link
                  href={`/dashboard/conversations/${item.sourceConversationId}`}
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
            <Section label={t('decisionReason')}>
              <p className="max-w-[62ch] text-[14.5px] leading-relaxed text-ink dark:text-foreground">
                {item.reason}
              </p>
            </Section>
          ) : null}

          {!published ? (
            <Section label={t('dismissedBodyLabel')}>
              <p className="max-w-[62ch] text-[14.5px] leading-relaxed text-ink-soft dark:text-foreground/70">
                {t('dismissedBodyGone')}
              </p>
            </Section>
          ) : publishedDocFailed ? (
            <Section label={t('publishedBodyLabel')}>
              <p className="max-w-[62ch] text-[14.5px] leading-relaxed text-ink-soft dark:text-foreground/70">
                {t('publishedBodyUnavailable')}
              </p>
            </Section>
          ) : publishedDoc ? (
            <Section label={t('publishedBodyLabel')}>
              <div className="max-w-[62ch] text-[15px] leading-[1.65] text-ink dark:text-foreground">
                <Markdown>{publishedDoc.body}</Markdown>
              </div>
            </Section>
          ) : (
            <PageSpinner />
          )}
        </div>
      </div>
    </section>
  );
}
