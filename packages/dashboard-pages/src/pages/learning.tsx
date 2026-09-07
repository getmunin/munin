'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@getmunin/ui';
import { api } from '../api';
import { useRealtime } from '../realtime';
import { useRelative } from '../lib/use-relative';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { useInboxData, InboxDrawers, type QueueItem } from '../components/dashboard/inbox-sections';

type DecisionOutcome = 'published' | 'dismissed';

interface CurationDecisionDto {
  id: string;
  sourceConversationId: string | null;
  candidateDocumentId: string;
  title: string;
  outcome: DecisionOutcome;
  reason: string | null;
  publishedDocumentId: string | null;
  decidedByActorType: string;
  decidedAt: string;
}

function StatusPill({ tone, children }: { tone: 'open' | DecisionOutcome; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'ml-auto inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[9px] uppercase tracking-eyebrow',
        tone === 'open'
          ? 'border-cobalt text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft'
          : tone === 'published'
            ? 'border-rule-soft text-ink-soft dark:border-rule-on-dark dark:text-foreground/70'
            : 'border-rule-soft text-ink-mute dark:border-rule-on-dark',
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function LearningCard({
  pill,
  meta,
  title,
  note,
  action,
  status,
  children,
}: {
  pill: string;
  meta: string;
  title: string;
  note?: string | null;
  action?: string | null;
  status: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 border border-rule-soft bg-paper-deep px-5 py-4 dark:border-rule-on-dark dark:bg-secondary">
      <div className="flex flex-wrap items-center gap-3">
        <span className="border border-ink px-2 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-ink dark:border-foreground dark:text-foreground">
          {pill}
        </span>
        <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-meta text-ink-mute">
          {meta}
        </span>
        {status}
      </div>
      <p className="font-serif text-lg leading-snug text-ink dark:text-foreground">{title}</p>
      {note ? <p className="text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">{note}</p> : null}
      {action ? (
        <div className="font-mono text-[11px] text-ink dark:text-foreground">
          <span aria-hidden className="text-cobalt dark:text-cobalt-soft">
            ∙
          </span>{' '}
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function LearningPage() {
  const t = useTranslations('dashboard.console.learning');
  const age = useRelative();
  const inbox = useInboxData();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const [decisions, setDecisions] = useState<CurationDecisionDto[]>([]);

  const loadDecisions = useCallback(() => {
    void api<{ items: CurationDecisionDto[] }>('/v1/kb/curation/decisions?limit=25')
      .then((res) => setDecisions(res.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadDecisions();
  }, [loadDecisions]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (event.type.startsWith('kb.')) loadDecisions();
  });

  if (inbox.loadError && !inbox.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
        />
      </div>
    );
  }

  const candidates = inbox.queue.filter((q): q is QueueItem & { kind: 'kb' } => q.kind === 'kb');
  const published = decisions.filter((d) => d.outcome === 'published').length;
  const dismissed = decisions.filter((d) => d.outcome === 'dismissed').length;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-ink px-5 pb-5 pt-8 md:px-8 dark:border-rule-on-dark">
        <div className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
          {t('eyebrow')}
        </div>
        <h1 className="mt-1.5 font-serif text-4xl font-normal leading-tight tracking-tight text-ink dark:text-foreground">
          {t.rich('title', {
            em: (chunks) => <em className="italic text-cobalt dark:text-cobalt-soft">{chunks}</em>,
          })}
        </h1>
      </header>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 border-b border-rule-soft px-5 py-2.5 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute md:px-8 dark:border-rule-on-dark">
        <span className="whitespace-nowrap text-cobalt dark:text-cobalt-soft">
          {t('metaPending', { count: candidates.length })}
        </span>
        <span aria-hidden>·</span>
        <span className="whitespace-nowrap">{t('metaPublished', { count: published })}</span>
        <span aria-hidden>·</span>
        <span className="whitespace-nowrap">{t('metaDismissed', { count: dismissed })}</span>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-6 md:px-8">
        {candidates.length === 0 ? (
          <p className="font-serif text-xl italic text-ink-soft dark:text-foreground/80">
            {t.rich('empty', {
              em: (chunks) => <span className="text-cobalt dark:text-cobalt-soft">{chunks}</span>,
            })}
          </p>
        ) : null}
        {candidates.map((item) => {
          const isRevision = !!item.raw.revisesDocumentId;
          return (
            <LearningCard
              key={item.id}
              pill={isRevision ? t('kindRevision') : t('kindArticle')}
              meta={t('candidateMeta', { age: age(item.createdAt) })}
              title={item.title}
              note={
                isRevision && item.raw.revisesDocumentTitle
                  ? t('revises', { title: item.raw.revisesDocumentTitle })
                  : item.snippet
              }
              action={t('candidateAction', {
                target: item.raw.proposedTargetSpaceSlug ?? 'support-faq',
              })}
              status={<StatusPill tone="open">{t('statusOpen')}</StatusPill>}
            >
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  variant="accent"
                  size="sm"
                  disabled={inbox.pending}
                  onClick={() => void inbox.approveQueue(item)}
                >
                  {isRevision ? t('publishRevision') : t('publish')} <span aria-hidden>→</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => inbox.setQueueDrawer(item)}>
                  {t('review')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={inbox.pending}
                  onClick={() => void inbox.dismissQueue(item)}
                >
                  {t('dismiss')}
                </Button>
              </div>
            </LearningCard>
          );
        })}

        {decisions.map((d) => (
          <LearningCard
            key={d.id}
            pill={d.outcome === 'published' ? t('kindDecision') : t('kindDismissed')}
            meta={t('decisionMeta', {
              by: d.decidedByActorType,
              age: age(d.decidedAt),
            })}
            title={d.title}
            note={d.reason}
            action={
              d.outcome === 'published'
                ? t('decisionShipped', { id: d.publishedDocumentId ?? d.candidateDocumentId })
                : t('decisionDismissed')
            }
            status={
              <StatusPill tone={d.outcome}>
                {d.outcome === 'published' ? t('statusShipped') : t('statusDismissed')}
              </StatusPill>
            }
          />
        ))}
      </div>

      <InboxDrawers controller={inbox} />
    </div>
  );
}
