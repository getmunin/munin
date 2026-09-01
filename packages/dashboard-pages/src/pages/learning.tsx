'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { diffLines } from '@getmunin/types';
import { Link } from '../i18n-navigation';
import { useRelative } from '../lib/use-relative';
import { ConsoleHero } from '../components/console-hero';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { useInboxData, InboxDrawers, type QueueItem } from '../components/dashboard/inbox-sections';
import { DEFAULT_CURATION_TARGET_SPACE } from '../components/dashboard/inbox-data';
import { Markdown } from '../components/dashboard/queue-drawers/shared';

type KbQueueItem = QueueItem & { kind: 'kb' };

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

function ProposalCard({
  item,
  pending,
  onPublish,
  onDismiss,
}: {
  item: KbQueueItem;
  pending: boolean;
  onPublish: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('dashboard.console.learning');
  const age = useRelative();
  const isRevision = !!item.raw.revisesDocumentId;
  const space = item.raw.proposedTargetSpaceSlug ?? DEFAULT_CURATION_TARGET_SPACE;
  const conversationId = item.raw.sourceConversationId;
  const revisedBody = item.raw.revisesDocumentBody;

  const passage = useMemo(
    () => (isRevision && revisedBody ? firstChangedPassage(revisedBody, item.raw.body) : null),
    [isRevision, revisedBody, item.raw.body],
  );

  return (
    <article className="flex flex-col gap-[11px] border border-rule-soft bg-paper-deep px-[22px] pb-[18px] pt-5 dark:border-rule-on-dark dark:bg-secondary">
      <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
        {isRevision
          ? t('kindRevisionOf', { title: item.raw.revisesDocumentTitle ?? item.title })
          : t('kindNew')}
      </div>
      <h3 className="font-serif text-[23px] font-normal leading-[1.2] text-ink dark:text-foreground">
        {item.title}
      </h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
        <span>{space}</span>
        <span aria-hidden>·</span>
        <span>{age(item.createdAt)}</span>
        {conversationId ? (
          <>
            <span aria-hidden>·</span>
            <Link
              href={`/dashboard/conversations/${conversationId}`}
              className="text-cobalt underline underline-offset-[3px] hover:text-cobalt-deep dark:text-cobalt-soft"
            >
              {t('sourceConversation')}
            </Link>
          </>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-col gap-5 border-t border-rule-soft pt-[18px] dark:border-rule-on-dark">
        {passage ? (
          <div className="flex flex-col gap-2.5">
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
              {t('changedPassage')}
            </div>
            <p className="max-w-[62ch] text-[14.5px] leading-relaxed text-ink-mute">
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

      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button variant="accent" size="sm" disabled={pending} onClick={onPublish}>
          {t('publish')} <span aria-hidden>→</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onDismiss}>
          {t('dismiss')}
        </Button>
      </div>
    </article>
  );
}

export function LearningPage() {
  const t = useTranslations('dashboard.console.learning');
  const inbox = useInboxData();
  const buildLoadFailedProps = useInboxLoadFailedProps();

  if (inbox.loadError && !inbox.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
        />
      </div>
    );
  }

  const candidates = inbox.queue.filter((q): q is KbQueueItem => q.kind === 'kb');

  return (
    <div className="flex min-h-full flex-col">
      <ConsoleHero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('lede')}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex max-w-[860px] flex-col gap-4 px-5 pb-20 pt-7 md:px-8">
          {candidates.length === 0 ? (
            <div className="flex flex-col gap-2 border border-rule-soft bg-paper-deep px-6 py-[26px] dark:border-rule-on-dark dark:bg-secondary">
              <h3 className="font-serif text-2xl font-normal leading-tight text-ink dark:text-foreground">
                {t('emptyTitle')}
              </h3>
              <p className="max-w-[56ch] text-sm leading-relaxed text-ink-soft dark:text-foreground/80">
                {t('emptyBody')}
              </p>
            </div>
          ) : (
            candidates.map((item) => (
              <ProposalCard
                key={item.id}
                item={item}
                pending={inbox.pending}
                onPublish={() => void inbox.approveQueue(item)}
                onDismiss={() => void inbox.dismissQueue(item)}
              />
            ))
          )}
        </div>
      </div>

      <InboxDrawers controller={inbox} />
    </div>
  );
}
