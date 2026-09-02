'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Pill, cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { ModuleGlyph, useCmdEnter } from './queue-drawers/shared';
import { humanizeFieldName, type CrmMergeProposalDto } from './queue-drawers/types';
import {
  comparableFieldCount,
  formatFieldValue,
  mergePatchChanges,
  type MergeFieldChange,
} from './merge-patch';
import { readMergeEvidence } from './merge-evidence';
import type { QueueActionError } from './inbox-types';
import { QueueActionErrorBanner } from './queue-action-error';

export type CrmQueueItem = {
  id: string;
  title: string;
  createdAt: string;
  raw: CrmMergeProposalDto;
};

const COMPARE_FIELDS = [
  'name',
  'email',
  'phone',
  'companyName',
  'title',
  'address',
  'tags',
  'customFields',
  'consentLawfulBasis',
  'consentSource',
  'lastContactedAt',
  'engagementScore',
] as const;

export function ReviewCrmPane({
  item,
  pending,
  actionError,
  onClearActionError,
  onApprove,
  onDismiss,
}: {
  item: CrmQueueItem;
  pending: boolean;
  actionError: QueueActionError;
  onClearActionError: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('dashboard.console.review.crm');
  const age = useRelative();
  const [compareAll, setCompareAll] = useState(false);

  const proposal = item.raw;
  const keeper =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactA : proposal.contactB;
  const duplicate =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactB : proposal.contactA;

  const changes = useMemo(
    () => mergePatchChanges(keeper, proposal.recommendedPatch),
    [keeper, proposal.recommendedPatch],
  );
  const evidence = useMemo(() => readMergeEvidence(proposal.evidence), [proposal.evidence]);
  const untouchedCount = Math.max(0, comparableFieldCount() - changes.length);

  useCmdEnter(() => {
    if (!pending) onApprove();
  });

  const label = (contact: typeof keeper) => contact.name ?? contact.email ?? contact.id;
  const pendingOutreach = proposal.impact?.pendingOutreach ?? [];
  const supersededCount = proposal.impact?.supersededProposalCount ?? 0;

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-paper dark:bg-background">
      <div className="flex flex-1 flex-col gap-5 px-5 pb-8 pt-6 md:px-7">
        <header className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="crm" marker="none">
              <ModuleGlyph kind="crm" className="size-[7px]" />
              {t('eyebrow')}
            </Pill>
            <span className="border-[1.5px] border-cobalt px-[6px] py-[2px] font-mono text-[9px] uppercase tracking-eyebrow text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              {t(proposal.confidence === 'high' ? 'confidenceHigh' : 'confidenceMedium')}
            </span>
            <span className="ml-auto font-mono text-[9px] uppercase tracking-meta text-ink-mute">
              {age(item.createdAt)}
            </span>
          </div>
          <h2 className="font-serif text-[26px] font-normal leading-[1.15] tracking-tight text-ink md:text-[29px] dark:text-foreground">
            {label(keeper)}
            <span aria-hidden className="px-2 text-ink-mute">
              ⟷
            </span>
            {label(duplicate)}
          </h2>
          <p className="max-w-[64ch] text-[14px] leading-relaxed text-ink-soft dark:text-foreground/80">
            {evidence.matchSentence ? `${evidence.matchSentence} ` : null}
            {t.rich('keeping', {
              name: label(keeper),
              strong: (chunks) => (
                <strong className="font-medium text-ink dark:text-foreground">{chunks}</strong>
              ),
            })}
            {evidence.keeperReason ? ` — ${evidence.keeperReason}.` : '.'}
          </p>
        </header>

        <div className="flex flex-col gap-2.5 border-t border-ink pt-4 dark:border-rule-on-dark">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
              {t('whatChanges')}
            </span>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-meta text-ink-mute">
              {t('changeCount', { count: changes.length, total: comparableFieldCount() })}
            </span>
          </div>

          {changes.length === 0 ? (
            <p className="max-w-[60ch] text-[13.5px] leading-relaxed text-ink-soft dark:text-foreground/80">
              {t('noChanges')}
            </p>
          ) : (
            <ul className="border border-ink dark:border-rule-on-dark">
              {changes.map((change) => (
                <ChangeRow key={change.field} change={change} t={t} />
              ))}
            </ul>
          )}

          <div className="flex items-baseline justify-between gap-4 border-t border-rule-soft pt-2.5 dark:border-rule-on-dark">
            <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute">
              {t('untouched', { count: untouchedCount })}
            </span>
            <button
              type="button"
              onClick={() => setCompareAll((open) => !open)}
              aria-expanded={compareAll}
              className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-cobalt underline-offset-[3px] hover:underline dark:text-cobalt-soft"
            >
              {compareAll ? t('compareHide') : t('compareAll')} <span aria-hidden>→</span>
            </button>
          </div>

          {compareAll ? (
            <table className="w-full border-collapse border border-rule-soft text-left dark:border-rule-on-dark">
              <thead>
                <tr className="border-b border-ink dark:border-rule-on-dark">
                  <th className="px-3 py-2 font-mono text-[8.5px] uppercase tracking-meta text-ink-mute" />
                  <th className="border-l border-rule-soft px-3 py-2 font-mono text-[8.5px] uppercase tracking-meta text-cobalt dark:border-rule-on-dark dark:text-cobalt-soft">
                    {t('columnKeeper')}
                  </th>
                  <th className="border-l border-rule-soft px-3 py-2 font-mono text-[8.5px] uppercase tracking-meta text-ink-mute dark:border-rule-on-dark">
                    {t('columnArchived')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_FIELDS.map((field) => {
                  const left = formatFieldValue(
                    (keeper as unknown as Record<string, unknown>)[field],
                  );
                  const right = formatFieldValue(
                    (duplicate as unknown as Record<string, unknown>)[field],
                  );
                  if (left === null && right === null) return null;
                  const differs = left !== right;
                  return (
                    <tr
                      key={field}
                      className="border-b border-rule-soft last:border-b-0 dark:border-rule-on-dark"
                    >
                      <th
                        scope="row"
                        className="w-[112px] px-3 py-2 align-top font-mono text-[9px] font-normal uppercase tracking-meta text-ink-mute"
                      >
                        {humanizeFieldName(field)}
                      </th>
                      <td
                        className={cn(
                          'border-l border-rule-soft px-3 py-2 align-top text-[12.5px] dark:border-rule-on-dark',
                          differs
                            ? 'text-ink dark:text-foreground'
                            : 'text-ink-mute dark:text-foreground/50',
                        )}
                      >
                        {left ?? '—'}
                      </td>
                      <td
                        className={cn(
                          'border-l border-rule-soft px-3 py-2 align-top text-[12.5px] dark:border-rule-on-dark',
                          differs
                            ? 'text-ink dark:text-foreground'
                            : 'text-ink-mute dark:text-foreground/50',
                        )}
                      >
                        {right ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-ink pt-4 dark:border-rule-on-dark">
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
            {t('andThen')}
          </span>
          <p className="max-w-[64ch] text-[14px] leading-relaxed text-ink dark:text-foreground">
            {t('consequences')}
            {pendingOutreach.length > 0 ? (
              <>
                {' '}
                <span className="text-alert-bad-ink">
                  {t('outreachCancelled', { count: pendingOutreach.length })}
                </span>
                {pendingOutreach[0]?.campaignName
                  ? ` — “${pendingOutreach[0].campaignName}”.`
                  : '.'}
              </>
            ) : null}
          </p>
          <span className="text-[12.5px] leading-relaxed text-ink-mute">
            {proposal.proposedByActorType === 'user' ? t('proposedByUser') : t('proposedByAgent')}
            {supersededCount > 0 ? ` · ${t('superseded', { count: supersededCount })}` : null}
          </span>
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-rule-soft bg-paper dark:border-rule-on-dark dark:bg-background">
        <QueueActionErrorBanner
          error={actionError?.itemId === item.id ? actionError : null}
          onDismiss={onClearActionError}
        />
        <div className="flex flex-col flex-wrap items-stretch gap-2 p-4 md:flex-row md:items-center md:px-5">
          <Button variant="accent" disabled={pending} onClick={onApprove} className="max-md:h-11">
            {t('apply')} <span aria-hidden>→</span>
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onDismiss} className="max-md:h-11">
            {t('dismiss')}
          </Button>
          <span className="hidden font-mono text-[9px] uppercase tracking-meta text-ink-mute md:ml-auto md:inline">
            {t('shortcutApply')}
          </span>
        </div>
      </div>
    </section>
  );
}

function ChangeRow({
  change,
  t,
}: {
  change: MergeFieldChange;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <li className="grid grid-cols-[128px_minmax(0,1fr)] border-b border-rule-soft last:border-b-0 dark:border-rule-on-dark">
      <span className="flex flex-col items-start gap-1.5 px-3 py-3">
        <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute">
          {humanizeFieldName(change.field)}
        </span>
        <span className="border border-rule-soft px-1.5 py-[1px] font-mono text-[8.5px] uppercase tracking-meta text-ink-soft dark:border-rule-on-dark dark:text-foreground/70">
          {t(`kind_${change.kind}`)}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-1 border-l border-rule-soft bg-paper-deep px-4 py-3 dark:border-rule-on-dark dark:bg-secondary">
        <span className="flex flex-wrap items-baseline gap-2 text-[14px] leading-snug">
          {change.before ? (
            <>
              <s className="text-ink-mute decoration-1">{change.before}</s>
              <span aria-hidden className="text-ink-mute">
                →
              </span>
            </>
          ) : null}
          <em className="not-italic font-medium text-cobalt dark:text-cobalt-soft">
            {change.after}
          </em>
        </span>
        {change.dropped.length > 0 ? (
          <span className="font-mono text-[9px] uppercase tracking-meta text-alert-bad-ink">
            {t('replacedNote', { dropped: change.dropped.join(', ') })}
          </span>
        ) : change.kind === 'replaced' ? (
          <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute">
            {t('replacedNoteNoDrop')}
          </span>
        ) : null}
      </span>
    </li>
  );
}
