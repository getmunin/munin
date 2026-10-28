'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { notify } from '../../lib/notify';
import type { JourneyDetailDto, PublishRequestDto } from './journey-types';

export function PublishDialog({
  journeyId,
  version,
  open,
  onClose,
  onPublished,
}: {
  journeyId: string;
  version: number;
  open: boolean;
  onClose: () => void;
  onPublished: (journey: JourneyDetailDto) => void;
}) {
  const t = useTranslations('dashboard.journeys.publish');
  const translate = useTranslateError();
  const [review, setReview] = useState<PublishRequestDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReview(null);
    setError(null);
    let cancelled = false;
    api<PublishRequestDto>(`/v1/journeys/${journeyId}/versions/${version}/request-publish`, { method: 'POST' })
      .then((r) => {
        if (!cancelled) setReview(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(translate(err) || t('loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, journeyId, version, translate, t]);

  async function confirm() {
    if (!review) return;
    setPending(true);
    try {
      const journey = await api<JourneyDetailDto>(`/v1/journeys/${journeyId}/versions/${version}/publish`, {
        method: 'POST',
        body: JSON.stringify({ fingerprint: review.fingerprint }),
      });
      notify.success(t('published', { version }));
      onPublished(journey);
    } catch (err) {
      notify.error(translate(err) || t('publishFailed'));
    } finally {
      setPending(false);
    }
  }

  const diff = review?.diff;
  const sim = review?.simulation;
  const sample = sim?.messages.find((m) => m.html);
  const smsSample = sim?.messages.find((m) => m.channel === 'sms' && m.body);

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title', { version })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        {!review && !error && <p className="mt-4 font-mono text-xs text-ink-mute">{t('preparing')}</p>}
        {review && diff && sim && (
          <div className="mt-4 max-h-[60vh] space-y-5 overflow-y-auto pr-1 text-sm">
            {diff.autoNodes.length > 0 && (
              <section className="rounded-card border-[1px] border-cobalt/50 bg-cobalt/5 p-3">
                <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt">{t('autoTitle')}</h3>
                <p className="mt-1 text-ink dark:text-foreground">
                  {t('autoBody', { nodes: diff.autoNodes.join(', ') })}
                </p>
                {(review.autoMessages ?? []).map((m) => (
                  <div key={m.nodeId} className="mt-2 rounded-card border-[1px] border-rule-soft p-2 text-xs dark:border-rule-on-dark">
                    <p className="font-mono text-ink-mute">
                      {t('autoMessageMeta', { node: m.nodeId, channel: m.channel, kind: m.class, author: m.draftBy === 'agent' ? 'agent' : 'fixed' })}
                    </p>
                    {m.subject && <p className="mt-1 font-medium text-ink dark:text-foreground">{m.subject}</p>}
                    <p className="mt-1 whitespace-pre-line text-ink-mute">{m.preview}</p>
                  </div>
                ))}
                {review.reviewStats
                  .filter((s) => diff.autoNodes.includes(s.nodeId))
                  .map((s) => (
                    <p key={s.nodeId} className="mt-1 font-mono text-xs text-ink-mute">
                      {t('autoEvidence', {
                        node: s.nodeId,
                        reviewed: s.reviewed,
                        rate: s.uneditedRate === null ? '—' : `${Math.round(s.uneditedRate * 100)} %`,
                      })}
                    </p>
                  ))}
              </section>
            )}
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('changes')}</h3>
              <p className="mt-1 text-ink dark:text-foreground">
                {diff.againstVersion === null
                  ? t('firstVersion')
                  : t('againstVersion', { version: diff.againstVersion })}
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-xs text-ink-mute">
                {diff.addedNodes.length > 0 && <li>{t('added', { nodes: diff.addedNodes.join(', ') })}</li>}
                {diff.changedNodes.length > 0 && <li>{t('changed', { nodes: diff.changedNodes.join(', ') })}</li>}
                {diff.removedNodes.length > 0 && <li>{t('removed', { nodes: diff.removedNodes.join(', ') })}</li>}
                {diff.changedBlocks.length > 0 && <li>{t('blocks', { blocks: diff.changedBlocks.join(', ') })}</li>}
              </ul>
            </section>
            {(review.validation.warnings.length > 0 || (sim.warnings ?? []).length > 0) && (
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('warnings')}</h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-mute">
                  {(sim.warnings ?? []).map((w) => (
                    <li key={`${w.code}-${w.nodeId}`}>
                      {t('noLawfulBasis', { count: w.count, size: sim.sample.size, node: w.nodeId })}
                    </li>
                  ))}
                  {review.validation.warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>
                      {w.nodeId ? <code>{w.nodeId}</code> : null} {w.message}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('simulation')}</h3>
              <p className="mt-1 text-ink dark:text-foreground">
                {t('simulationSummary', { size: sim.sample.size, entered: sim.entered })}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-ink-mute">
                {Object.entries(sim.excluded).map(([reason, n]) => (
                  <Row key={`x-${reason}`} label={t('excluded', { reason })} value={n} />
                ))}
                {Object.entries(sim.exits).map(([reason, n]) => (
                  <Row key={`e-${reason}`} label={t('exit', { reason })} value={n} />
                ))}
                {Object.entries(sim.messageDecisions).flatMap(([node, decisions]) =>
                  Object.entries(decisions).map(([decision, n]) => (
                    <Row key={`m-${node}-${decision}`} label={t('email', { node, decision })} value={n} />
                  )),
                )}
              </dl>
              {sim.agentCost && sim.agentCost.runs > 0 && (
                <p className="mt-2 text-xs text-ink-mute">
                  {t('agentCost', {
                    runs: sim.agentCost.runs,
                    tokens: sim.agentCost.estimatedTokens.toLocaleString(),
                    usd: sim.agentCost.estimatedUsd.toFixed(2),
                  })}
                </p>
              )}
              {sim.assumptions.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-mute">
                  {sim.assumptions.map((a) => (
                    <li key={`${a.code}-${a.nodeId}`}>
                      {a.code === 'reviewer_approves'
                        ? t('assumeApproved', { node: a.nodeId })
                        : a.code === 'no_reply'
                          ? t('assumeNoReply', { node: a.nodeId })
                          : a.code === 'agent_draft'
                            ? t('assumeAgentDraft', { node: a.nodeId })
                            : a.code === 'agent_fallback'
                            ? t('assumeAgentFallback', { node: a.nodeId, edge: a.event ?? '' })
                            : a.code === 'call_reached'
                              ? t('assumeCallReached', { node: a.nodeId })
                              : a.code === 'chat_seen'
                              ? t('assumeChatSeen', { node: a.nodeId })
                              : a.code === 'approval_granted'
                                ? t('assumeApprovalGranted', { node: a.nodeId })
                                : a.code === 'sub_journey_passed'
                                  ? t('assumeSubJourney', { node: a.nodeId, journey: a.event ?? '' })
                                  : t('assumeNoEvent', { node: a.nodeId, event: a.event ?? '', timeout: a.timeout ?? '' })}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {smsSample?.body && (
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">
                  {t('smsSample', { name: smsSample.contactName ?? '—' })}
                </h3>
                <p className="mt-2 whitespace-pre-wrap rounded-card border-[1px] border-rule-soft p-3 text-sm dark:border-rule-on-dark">
                  {smsSample.body}
                </p>
              </section>
            )}
            {sample?.html && (
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">
                  {t('sample', { subject: sample.subject ?? '', name: sample.contactName ?? '—' })}
                </h3>
                <iframe
                  title={t('sampleFrame')}
                  sandbox=""
                  srcDoc={sample.html}
                  className="mt-2 h-80 w-full rounded-card border-[1px] border-rule-soft bg-white dark:border-rule-on-dark"
                />
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="accent" disabled={!review || pending} pending={pending} onClick={() => void confirm()}>
            {t('confirm', { version })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right text-ink dark:text-foreground">{value}</dd>
    </>
  );
}
