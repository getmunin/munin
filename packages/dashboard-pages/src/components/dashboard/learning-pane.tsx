'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { diffLines } from '@getmunin/types';
import { Link } from '../../i18n-navigation';
import { useRelative } from '../../lib/use-relative';
import { DEFAULT_CURATION_TARGET_SPACE } from './inbox-data';
import { Markdown } from './queue-drawers/shared';
import type { KbQueueItem } from './learning-row';
import type { QueueActionError } from './inbox-types';
import { QueueActionErrorBanner } from './queue-action-error';

function stripLeadingHeading(body: string) {
  return body.replace(/^\s*#{1,6}[ \t]+[^\n]*(?:\r?\n)+/, '');
}

function firstChangedPassage(before: string, after: string) {
  const lines = diffLines(before, after);
  const removed = lines.find((l) => l.op === 'removed' && l.text.trim())?.text.trim();
  const added = lines.find((l) => l.op === 'added' && l.text.trim())?.text.trim();
  if (!removed || !added) return null;
  return { before: removed, after: added };
}

export function LearningPane({
  item,
  pending,
  actionError,
  onClearActionError,
  onPublish,
  onDismiss,
}: {
  item: KbQueueItem | undefined;
  pending: boolean;
  actionError: QueueActionError;
  onClearActionError: () => void;
  onPublish: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('dashboard.console.learning');
  const age = useRelative();
  const isRevision = !!item?.raw.revisesDocumentId;
  const revisedBody = item?.raw.revisesDocumentBody;
  const passage = useMemo(
    () => (item && isRevision && revisedBody ? firstChangedPassage(revisedBody, item.raw.body) : null),
    [item, isRevision, revisedBody],
  );

  if (!item) {
    return <section className="hidden min-h-0 flex-col bg-paper-deep md:flex dark:bg-secondary" />;
  }

  const space = item.raw.proposedTargetSpaceSlug ?? DEFAULT_CURATION_TARGET_SPACE;
  const conversationId = item.raw.sourceConversationId;

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-paper dark:bg-background">
      <div className="flex flex-1 flex-col gap-5 px-5 pb-8 pt-6 md:px-7">
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {isRevision
              ? t('kindRevisionOf', { title: item.raw.revisesDocumentTitle ?? item.title })
              : t('kindNew')}
          </div>
          <h2 className="max-w-[42ch] font-serif text-[26px] font-normal leading-[1.2] text-ink md:text-[30px] dark:text-foreground">
            {item.title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
            <span>{space}</span>
            <span aria-hidden>·</span>
            <span>{age(item.createdAt)}</span>
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
          {passage ? (
            <div className="flex flex-col gap-2.5">
              <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
                {t('changedPassage')}
              </div>
              <p className="max-w-[62ch] text-[14.5px] leading-relaxed text-ink-soft dark:text-foreground/70">
                {passage.before}
              </p>
              <div className="flex items-center gap-3">
                <span aria-hidden className="font-mono text-[13px] text-cobalt dark:text-cobalt-soft">
                  →
                </span>
                <span aria-hidden className="h-px flex-1 bg-rule-soft dark:bg-rule-on-dark" />
              </div>
              <p className="max-w-[58ch] font-serif text-lg leading-[1.45] text-ink dark:text-foreground">
                {passage.after}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-[11px]">
            {passage ? (
              <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
                {t('bodyLabelRevision')}
              </div>
            ) : null}
            <div className="max-w-[62ch] text-[15px] leading-[1.65] text-ink dark:text-foreground">
              <Markdown>{stripLeadingHeading(item.raw.body)}</Markdown>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-rule-soft bg-paper dark:border-rule-on-dark dark:bg-background">
        <QueueActionErrorBanner
          error={actionError?.itemId === item.id ? actionError : null}
          onDismiss={onClearActionError}
        />
        <div className="flex flex-col flex-wrap items-stretch gap-2 p-4 md:flex-row md:items-center md:px-5">
          <Button variant="accent" disabled={pending} onClick={onPublish} className="max-md:h-11">
            {t('publish')} <span aria-hidden>→</span>
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onDismiss} className="max-md:h-11">
            {t('dismiss')}
          </Button>
        </div>
      </div>
    </section>
  );
}
