'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { PageSpinner } from '@getmunin/ui';
import { Link } from '../../i18n-navigation';
import { useRelative } from '../../lib/use-relative';
import { Markdown } from './queue-panes/shared';
import type { PublishedDocument, ReviewDecidedItem } from './review-decided';
import {
  decidedConversationId,
  decidedOutcomeLabel,
  decidedTitle,
} from './review-decided-labels';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">{label}</div>
      {children}
    </div>
  );
}

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
  publishedDoc,
  publishedDocFailed,
  onLoadPublishedDoc,
}: {
  item: ReviewDecidedItem | undefined;
  publishedDoc: PublishedDocument | undefined;
  publishedDocFailed: boolean;
  onLoadPublishedDoc: (id: string) => void;
}) {
  const t = useTranslations('dashboard.console.review');
  const age = useRelative();

  const publishedId =
    item?.kind === 'kb' && item.producedRef?.type === 'kb_document'
      ? item.producedRef.id
      : null;
  useEffect(() => {
    if (!publishedId) return;
    if (publishedDoc || publishedDocFailed) return;
    onLoadPublishedDoc(publishedId);
  }, [publishedId, publishedDoc, publishedDocFailed, onLoadPublishedDoc]);

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
            <Section label={t('decisionReason')}>
              <Prose>{item.reason}</Prose>
            </Section>
          ) : null}

          {publishedId ? (
            publishedDocFailed ? (
              <Section label={t('publishedBodyLabel')}>
                <Prose muted>{t('publishedBodyUnavailable')}</Prose>
              </Section>
            ) : publishedDoc ? (
              <Section label={t('publishedBodyLabel')}>
                <div className="max-w-[62ch] text-[15px] leading-[1.65] text-ink dark:text-foreground">
                  <Markdown>{publishedDoc.body}</Markdown>
                </div>
              </Section>
            ) : (
              <PageSpinner />
            )
          ) : (
            <Section label={t('decisionRecordLabel')}>
              <Prose muted>{t(`decidedSummary.${item.kind}.${item.outcome}`)}</Prose>
            </Section>
          )}
        </div>
      </div>
    </section>
  );
}
