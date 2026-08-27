'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BodyDiff, Button } from '@getmunin/ui';
import { api } from '../api';
import { EmptyCallout } from '../components/empty-callout';
import { LoadFailed } from '../components/load-failed';
import { useInboxData } from '../components/dashboard/inbox-data';
import { InboxDrawers } from '../components/dashboard/inbox-sections';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';
import { useRelative } from '../lib/use-relative';
import { useRealtime } from '../realtime';
import type { KbCandidateDto, QueueItem } from '../components/dashboard/queue-drawers/types';

const DECISION_LIMIT = 20;

interface CurationDecisionDto {
  id: string;
  candidateDocumentId: string;
  title: string;
  outcome: 'dismissed' | 'published';
  reason: string | null;
  decidedByActorType: string;
  decidedAt: string;
}

interface DecisionListResponse {
  items: CurationDecisionDto[];
}

export function LearningPage() {
  const t = useTranslations('dashboard.learning');
  const inbox = useInboxData();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const age = useRelative();

  const [decisions, setDecisions] = useState<CurationDecisionDto[]>([]);
  const [bodies, setBodies] = useState<Record<string, KbCandidateDto>>({});

  const loadDecisions = useCallback(async () => {
    try {
      const page = await api<DecisionListResponse>(
        `/v1/kb/curation/decisions?limit=${DECISION_LIMIT}`,
      );
      setDecisions(page.items);
    } catch (err) {
      console.warn('[learning] decisions fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadDecisions();
  }, [loadDecisions]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (event.type.startsWith('kb.')) void loadDecisions();
  });

  const candidates = useMemo(
    () => inbox.queue.filter((item): item is QueueItem & { kind: 'kb' } => item.kind === 'kb'),
    [inbox.queue],
  );

  const revisionIds = useMemo(
    () => candidates.filter((c) => c.raw.revisesDocumentId).map((c) => c.id),
    [candidates],
  );

  useEffect(() => {
    for (const id of revisionIds) {
      if (bodies[id] !== undefined) continue;
      void api<KbCandidateDto>(`/v1/kb/curation/candidates/${id}`)
        .then((dto) => setBodies((prev) => ({ ...prev, [id]: dto })))
        .catch(() => {});
    }
  }, [revisionIds, bodies]);

  const decidedLast7Days = decisions.filter(
    (d) => Date.parse(d.decidedAt) > Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).length;

  if (inbox.loadError && !inbox.hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(inbox.loadError, () => void inbox.retryLoad(), inbox.retrying)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-10 md:py-11">
      <header>
        <p className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:text-foreground/55">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 font-serif text-[38px] font-normal leading-[1.02] tracking-tight text-ink md:text-[48px] dark:text-foreground">
          {t.rich('title', { em: (chunks) => <em className="italic text-cobalt">{chunks}</em> })}
        </h1>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
          <span>{t('statPending', { count: candidates.length })}</span>
          <span aria-hidden>·</span>
          <span>{t('statDecided', { count: decidedLast7Days })}</span>
        </p>
      </header>

      <section className="mt-9">
        <div className="flex items-baseline justify-between gap-4 border-b-[1px] border-ink pb-2.5 dark:border-rule-on-dark">
          <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink dark:text-foreground">
            {t('pendingHeading')} · {candidates.length}
          </h2>
        </div>
        {candidates.length === 0 ? (
          <div className="pt-6">
            <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
          </div>
        ) : (
          <ul>
            {candidates.map((item) => {
              const detail = bodies[item.id];
              const isRevision = item.raw.revisesDocumentId != null;
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 border-b-[1px] border-rule-soft py-4 dark:border-rule-on-dark"
                >
                  <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
                    <span>{isRevision ? t('typeRevision') : t('typeProposal')}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">
                      {item.raw.proposedTargetSpaceSlug ?? item.raw.revisesDocumentTitle ?? ''}
                    </span>
                    <span className="ml-auto shrink-0 text-ink dark:text-foreground">
                      {age(item.createdAt)}
                    </span>
                  </span>

                  <span className="text-[15px] leading-snug text-ink [text-wrap:pretty] dark:text-foreground">
                    {item.title}
                  </span>

                  {isRevision && detail?.revisesDocumentBody != null && detail.body != null ? (
                    <BodyDiff
                      before={detail.revisesDocumentBody}
                      after={detail.body}
                      unchangedLabel={t('diffUnchanged')}
                    />
                  ) : (
                    <span className="text-[13px] leading-snug text-ink-mute dark:text-foreground/55">
                      {item.snippet}
                    </span>
                  )}

                  <span className="mt-1 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="accent"
                      className="max-sm:min-h-11 max-sm:flex-1"
                      onClick={() => inbox.setQueueDrawer(item)}
                      disabled={inbox.pending}
                    >
                      {t('review')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="max-sm:min-h-11 max-sm:flex-1"
                      onClick={() => void inbox.dismissQueue(item)}
                      disabled={inbox.pending}
                    >
                      {t('dismiss')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {decisions.length > 0 && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4 border-b-[1px] border-ink pb-2.5 dark:border-rule-on-dark">
            <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink dark:text-foreground">
              {t('decidedHeading')}
            </h2>
          </div>
          <ul>
            {decisions.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-1.5 border-b-[1px] border-rule-soft py-3.5 dark:border-rule-on-dark"
              >
                <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
                  <span
                    className={
                      d.outcome === 'published'
                        ? 'text-cobalt dark:text-cobalt-soft'
                        : 'text-ink-mute'
                    }
                  >
                    {t(`outcome.${d.outcome}`)}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{t(`actor.${actorKey(d.decidedByActorType)}`)}</span>
                  <span className="ml-auto shrink-0 text-ink dark:text-foreground">
                    {age(d.decidedAt)}
                  </span>
                </span>
                <span className="text-[14.5px] leading-snug text-ink [text-wrap:pretty] dark:text-foreground">
                  {d.title}
                </span>
                {d.reason ? (
                  <span className="text-[13px] leading-snug text-ink-mute dark:text-foreground/55">
                    {d.reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <InboxDrawers controller={inbox} />
    </div>
  );
}

function actorKey(actorType: string): 'user' | 'agent' | 'system' {
  if (actorType === 'user') return 'user';
  if (actorType === 'system') return 'system';
  return 'agent';
}
