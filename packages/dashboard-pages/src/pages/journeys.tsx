'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import {
  Button,
  Pill,
  SectionHead,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTrigger,
  cn,
} from '@getmunin/ui';
import { api } from '../api';
import { ConsoleHero } from '../components/console-hero';
import { Link } from '../i18n-navigation';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { TableSkeleton } from '../components/skeleton';
import { EmptyCallout } from '../components/empty-callout';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import { JourneyGraph } from '../components/journeys/journey-graph';
import { PublishDialog } from '../components/journeys/publish-dialog';
import type {
  EnrollmentDto,
  JourneyDetailDto,
  JourneyDto,
  JourneyReportDto,
  JourneyStatus,
  JourneyVersionSummaryDto,
  AgentNodeStatsDto,
  JourneyApprovalDto,
  NodeReviewStatsDto,
  TraceDto,
} from '../components/journeys/journey-types';

export function JourneysPage({ selectedId, publishVersion }: { selectedId?: string; publishVersion?: number }) {
  return selectedId ? <JourneyDetail id={selectedId} publishVersion={publishVersion} /> : <JourneyList />;
}

function JourneyList() {
  const t = useTranslations('dashboard.journeys');
  const format = useFormatter();
  const now = useNow();
  const [items, setItems] = useState<JourneyDto[] | null>(null);
  const load = useCallback(async () => {
    const res = await api<{ items: JourneyDto[] }>('/v1/journeys');
    setItems(res.items);
  }, []);
  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();
  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  if (loadError && !hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed {...buildLoadFailedProps('journeys', loadError, () => void retry(), retrying)} />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ConsoleHero eyebrow={t('eyebrow')} title={t.rich('title', { em: (c) => <em>{c}</em> })} lede={t('subtitle')} />
      <section className="flex-1 space-y-4 px-5 pb-10 pt-1 md:px-8">
        <SectionHead title={t('listTitle')} divider={false} />
        {items === null ? (
          <TableSkeleton
            columns={[
              { grow: 4, bar: 'w-2/3' },
              { grow: 2, bar: 'w-1/2' },
              { grow: 2, bar: 'w-1/2' },
              { grow: 2, bar: 'w-3/4' },
            ]}
          />
        ) : items.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t.rich('emptyBody', { code: (c) => <code>{c}</code> })} />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
            <table className="w-full">
              <thead>
                <tr className="border-b-[1px] border-rule-soft text-left dark:border-rule-on-dark">
                  <Th>{t('table.name')}</Th>
                  <Th>{t('table.status')}</Th>
                  <Th className="hidden md:table-cell">{t('table.versions')}</Th>
                  <Th>{t('table.updated')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((j) => (
                  <tr key={j.id} className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
                    <td className="py-4 pr-4">
                      <Link
                        href={`/dashboard/journeys/${j.id}`}
                        className="text-sm font-medium text-ink hover:text-cobalt dark:text-foreground"
                      >
                        {j.name}
                      </Link>
                      {j.description && <div className="mt-0.5 text-xs text-ink-mute">{j.description}</div>}
                    </td>
                    <td className="py-4 pr-4">
                      <StatusPill status={j.status} />
                    </td>
                    <td className="hidden py-4 pr-4 font-mono text-xs text-ink-mute md:table-cell">
                      {versionLabel(t, j.liveVersion, j.draftVersion)}
                    </td>
                    <td className="py-4 pr-4 font-mono text-xs text-ink-mute">
                      {format.relativeTime(new Date(j.updatedAt), now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function JourneyDetail({ id, publishVersion }: { id: string; publishVersion?: number }) {
  const t = useTranslations('dashboard.journeys');
  const translate = useTranslateError();
  const [journey, setJourney] = useState<JourneyDetailDto | null>(null);
  const [versions, setVersions] = useState<JourneyVersionSummaryDto[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentDto[]>([]);
  const [report, setReport] = useState<JourneyReportDto | null>(null);
  const [reviewStats, setReviewStats] = useState<NodeReviewStatsDto[]>([]);
  const [agentStats, setAgentStats] = useState<AgentNodeStatsDto[]>([]);
  const [approvals, setApprovals] = useState<JourneyApprovalDto[]>([]);
  const [graphOf, setGraphOf] = useState<'live' | 'draft'>('live');
  const [publishing, setPublishing] = useState<number | null>(publishVersion ?? null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [detail, versionList, people, results, stats, agents, pendingApprovals] = await Promise.all([
      api<JourneyDetailDto>(`/v1/journeys/${id}`),
      api<{ items: JourneyVersionSummaryDto[] }>(`/v1/journeys/${id}/versions`),
      api<{ items: EnrollmentDto[] }>(`/v1/journeys/${id}/enrollments?limit=100`),
      api<JourneyReportDto>(`/v1/journeys/${id}/report`),
      api<{ items: NodeReviewStatsDto[] }>(`/v1/journeys/${id}/review-stats`),
      api<{ items: AgentNodeStatsDto[] }>(`/v1/journeys/${id}/agent-stats`),
      api<{ items: JourneyApprovalDto[] }>(`/v1/journey-approvals?status=pending&journeyId=${encodeURIComponent(id)}`),
    ]);
    setApprovals(pendingApprovals.items);
    setReviewStats(stats.items);
    setAgentStats(agents.items);
    setJourney(detail);
    setVersions(versionList.items);
    setEnrollments(people.items);
    setReport(results);
    setGraphOf(detail.live ? 'live' : 'draft');
  }, [id]);
  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();
  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  async function lifecycle(action: 'pause' | 'resume') {
    setBusy(true);
    try {
      await api(`/v1/journeys/${id}/${action}`, { method: 'POST' });
      notify.success(t(action === 'pause' ? 'paused' : 'resumed'));
      await load();
    } catch (err) {
      notify.error(translate(err) || t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(approvalId: string, decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await api(`/v1/journey-approvals/${approvalId}/decide`, { method: 'POST', body: JSON.stringify({ decision }) });
      notify.success(t(decision === 'approve' ? 'approvalApproved' : 'approvalRejected'));
      await load();
    } catch (err) {
      notify.error(translate(err) || t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function resumeNode(nodeId: string) {
    setBusy(true);
    try {
      await api(`/v1/journeys/${id}/nodes/${encodeURIComponent(nodeId)}/resume`, { method: 'POST' });
      notify.success(t('nodeResumed', { node: nodeId }));
      await load();
    } catch (err) {
      notify.error(translate(err) || t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed {...buildLoadFailedProps('journeys', loadError, () => void retry(), retrying)} />
      </div>
    );
  }
  if (!journey) {
    return <TableSkeleton columns={[{ grow: 4, bar: 'w-2/3' }, { grow: 2, bar: 'w-1/2' }]} />;
  }

  const shown = graphOf === 'live' ? journey.live : journey.draft;
  const counts = report ? Object.fromEntries(report.nodes.map((n) => [n.nodeId, n.arrived])) : undefined;

  return (
    <div className="flex min-h-full flex-col">
      <ConsoleHero
        eyebrow={
          <Link href="/dashboard/journeys" className="hover:text-cobalt">
            {t('back')}
          </Link>
        }
        title={journey.name}
        lede={journey.description ?? t('detailSubtitle')}
      />
      <div className="flex-1 px-5 pb-10 pt-1 md:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusPill status={journey.status} />
        <span className="font-mono text-xs text-ink-mute">
          {versionLabel(t, journey.liveVersion, journey.draftVersion)}
        </span>
        <div className="ml-auto flex gap-2">
          {journey.status === 'live' && (
            <Button variant="outline" size="sm" pending={busy} onClick={() => void lifecycle('pause')}>
              {t('pause')}
            </Button>
          )}
          {journey.status === 'paused' && (
            <Button variant="outline" size="sm" pending={busy} onClick={() => void lifecycle('resume')}>
              {t('resume')}
            </Button>
          )}
          {journey.draft && journey.status !== 'archived' && (
            <Button variant="accent" size="sm" onClick={() => setPublishing(journey.draft!.number)}>
              {t('reviewPublish', { version: journey.draft.number })}
            </Button>
          )}
        </div>
      </div>

      {approvals.map((approval) => (
        <div
          key={approval.id}
          className="mb-4 flex flex-wrap items-center gap-3 rounded-card border-[1px] border-rule-soft px-4 py-3 text-sm dark:border-rule-on-dark"
        >
          <Pill tone="review">{t('approvalPending')}</Pill>
          <div className="min-w-0 flex-1">
            <p className="text-ink dark:text-foreground">
              {approval.title} · {approval.contactName ?? approval.contactId ?? '—'}
            </p>
            {approval.instructions && <p className="text-xs text-ink-mute">{approval.instructions}</p>}
          </div>
          <Button variant="outline" size="sm" pending={busy} onClick={() => void decide(approval.id, 'reject')}>
            {t('reject')}
          </Button>
          <Button variant="accent" size="sm" pending={busy} onClick={() => void decide(approval.id, 'approve')}>
            {t('approve')}
          </Button>
        </div>
      ))}

      {Object.entries(journey.pausedNodes ?? {}).map(([nodeId, info]) => (
        <div
          key={nodeId}
          className="mb-4 flex flex-wrap items-center gap-3 rounded-card border-[1px] border-rule-soft px-4 py-3 text-sm dark:border-rule-on-dark"
        >
          <Pill tone="review">{t('nodePaused')}</Pill>
          <span className="text-ink dark:text-foreground">
            {info.reason === 'guardrail' && info.metric
              ? t('nodePausedGuardrail', { node: nodeId, metric: t(`guardrail.${info.metric}`), rate: info.rate ?? 0 })
              : t('nodePausedManual', { node: nodeId })}
          </span>
          <Button className="ml-auto" variant="outline" size="sm" pending={busy} onClick={() => void resumeNode(nodeId)}>
            {t('resumeNode')}
          </Button>
        </div>
      ))}

      <Tabs defaultValue="graph">
        <TabsList>
          <TabsTrigger value="graph">{t('tabs.graph')}</TabsTrigger>
          <TabsTrigger value="people">{t('tabs.people')}</TabsTrigger>
          <TabsTrigger value="report">{t('tabs.report')}</TabsTrigger>
          <TabsTrigger value="versions">{t('tabs.versions')}</TabsTrigger>
        </TabsList>

        <TabsPanel value="graph">
          {journey.live && journey.draft && (
            <div className="mb-3 flex gap-2">
              {(['live', 'draft'] as const).map((which) => (
                <Button
                  key={which}
                  size="sm"
                  variant={graphOf === which ? 'accent' : 'outline'}
                  onClick={() => setGraphOf(which)}
                >
                  {t(which === 'live' ? 'showLive' : 'showDraft', {
                    version: which === 'live' ? journey.live!.number : journey.draft!.number,
                  })}
                </Button>
              ))}
            </div>
          )}
          {shown ? (
            <JourneyGraph
              spec={shown.spec}
              counts={graphOf === 'live' ? counts : undefined}
              emptyLabel={t('graphInvalid')}
            />
          ) : (
            <EmptyCallout title={t('noVersionTitle')} body={t('noVersionBody')} />
          )}
          {shown?.validation && !shown.validation.valid && (
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-destructive">
              {shown.validation.errors.map((e, i) => (
                <li key={`${e.code}-${i}`}>
                  {e.nodeId && <code>{e.nodeId}</code>} {e.message}
                </li>
              ))}
            </ul>
          )}
        </TabsPanel>

        <TabsPanel value="people">
          {enrollments.length === 0 ? (
            <EmptyCallout title={t('people.emptyTitle')} body={t('people.emptyBody')} />
          ) : (
            <EnrollmentTable enrollments={enrollments} onOpen={setTraceId} />
          )}
        </TabsPanel>

        <TabsPanel value="report">{report && <ReportView report={report} reviewStats={reviewStats} agentStats={agentStats} />}</TabsPanel>

        <TabsPanel value="versions">
          <VersionList versions={versions} onPublish={(n) => setPublishing(n)} />
        </TabsPanel>
      </Tabs>

      {publishing !== null && (
        <PublishDialog
          journeyId={id}
          version={publishing}
          open
          onClose={() => setPublishing(null)}
          onPublished={() => {
            setPublishing(null);
            void load();
          }}
        />
      )}
      <TraceSheet enrollmentId={traceId} onClose={() => setTraceId(null)} />
      </div>
    </div>
  );
}

function EnrollmentTable({ enrollments, onOpen }: { enrollments: EnrollmentDto[]; onOpen: (id: string) => void }) {
  const t = useTranslations('dashboard.journeys.people');
  const format = useFormatter();
  const now = useNow();
  return (
    <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
      <table className="w-full">
        <thead>
          <tr className="border-b-[1px] border-rule-soft text-left dark:border-rule-on-dark">
            <Th>{t('person')}</Th>
            <Th>{t('state')}</Th>
            <Th>{t('where')}</Th>
            <Th>{t('entered')}</Th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((e) => (
            <tr
              key={e.id}
              className="cursor-pointer border-b-[1px] border-rule-soft hover:bg-paper-deep/50 dark:border-rule-on-dark"
              onClick={() => onOpen(e.id)}
            >
              <td className="py-3 pr-4 font-mono text-xs text-ink dark:text-foreground">
                {e.contactName ?? e.contactEmail ?? e.contactId ?? e.endUserId}
                {e.holdout && <span className="ml-2 text-ink-mute">{t('holdout')}</span>}
              </td>
              <td className="py-3 pr-4 font-mono text-xs text-ink-mute">{e.state}</td>
              <td className="py-3 pr-4 font-mono text-xs text-ink-mute">{e.exitReason ?? e.currentNode ?? '—'}</td>
              <td className="py-3 pr-4 font-mono text-xs text-ink-mute">
                {format.relativeTime(new Date(e.enteredAt), now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TraceSheet({ enrollmentId, onClose }: { enrollmentId: string | null; onClose: () => void }) {
  const t = useTranslations('dashboard.journeys.trace');
  const format = useFormatter();
  const [trace, setTrace] = useState<TraceDto | null>(null);
  useEffect(() => {
    setTrace(null);
    if (!enrollmentId) return;
    let cancelled = false;
    void api<TraceDto>(`/v1/journeys/enrollments/${enrollmentId}/trace`).then((r) => {
      if (!cancelled) setTrace(r);
    });
    return () => {
      cancelled = true;
    };
  }, [enrollmentId]);
  return (
    <Sheet open={enrollmentId !== null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        {!trace ? (
          <p className="p-4 font-mono text-xs text-ink-mute">{t('loading')}</p>
        ) : (
          <ol className="space-y-3 p-4">
            {trace.steps.map((s, i) => (
              <li key={`${s.nodeId}-${s.visit}-${i}`} className="border-l-2 border-rule-soft pl-3 dark:border-rule-on-dark">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs text-ink dark:text-foreground">
                    {s.nodeId}
                    <span className="ml-2 text-ink-label">{s.nodeType}</span>
                  </span>
                  <span className="font-mono text-[10px] text-ink-mute">
                    {format.dateTime(new Date(s.startedAt), { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-ink-mute">
                  {s.status}
                  {s.edgeTaken && ` → ${s.edgeTaken}`}
                  {s.reason && ` · ${s.reason}`}
                  {s.attempt > 1 && ` · ${t('attempt', { attempt: s.attempt })}`}
                  {s.agent && ` · ${t('agent', { status: s.agent.status, tokens: s.agent.totalTokens ?? '—' })}`}
                </div>
              </li>
            ))}
            {trace.openWaits.map((w, i) => (
              <li key={`wait-${i}`} className="border-l-2 border-cobalt pl-3 text-xs text-ink-mute">
                {t('waiting', {
                  kind: w.kind,
                  until:
                    w.wakeAt || w.timeoutAt
                      ? format.dateTime(new Date((w.wakeAt ?? w.timeoutAt)!), { dateStyle: 'medium', timeStyle: 'short' })
                      : '—',
                  event: w.eventKey ?? '—',
                })}
              </li>
            ))}
            {trace.enrollment.exitReason && (
              <li className="pl-3 font-mono text-xs text-ink dark:text-foreground">
                {t('ended', { reason: trace.enrollment.exitReason })}
              </li>
            )}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReportView({
  report,
  reviewStats,
  agentStats,
}: {
  report: JourneyReportDto;
  reviewStats: NodeReviewStatsDto[];
  agentStats: AgentNodeStatsDto[];
}) {
  const t = useTranslations('dashboard.journeys.report');
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)} %`);
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('goal')}</h3>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-mute">{t('treated')}</dt>
          <dd className="text-right font-mono">
            {pct(report.goal.treated.rate)} · {report.goal.treated.converted}/{report.goal.treated.entered}
          </dd>
          <dt className="text-ink-mute">{t('holdout')}</dt>
          <dd className="text-right font-mono">
            {pct(report.goal.holdout.rate)} · {report.goal.holdout.converted}/{report.goal.holdout.entered}
          </dd>
          <dt className="text-ink-mute">{t('lift')}</dt>
          <dd className="text-right font-mono">{pct(report.goal.lift)}</dd>
        </dl>
      </section>
      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('integrity')}</h3>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
          <StatRow label={t('duplicateSends')} value={report.integrity.duplicateSends} />
          <StatRow label={t('untraced')} value={report.integrity.enrollmentsWithoutTrace} />
        </dl>
      </section>
      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">
          {t('enrollments', { total: report.enrollments.total })}
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
          {Object.entries(report.enrollments.exitReasons).map(([reason, n]) => (
            <StatRow key={reason} label={reason} value={n} />
          ))}
        </dl>
      </section>
      {agentStats.length > 0 && (
        <section className="md:col-span-2">
          <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('agents')}</h3>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b-[1px] border-rule-soft text-left dark:border-rule-on-dark">
                <Th>{t('node')}</Th>
                <Th className="text-right">{t('agentRuns')}</Th>
                <Th className="text-right">{t('fallbackRate')}</Th>
                <Th className="text-right">{t('avgTokens')}</Th>
                <Th>{t('agentOutcome')}</Th>
              </tr>
            </thead>
            <tbody>
              {agentStats.map((s) => (
                <tr key={s.nodeId} className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {s.nodeId} <span className="text-ink-label">{s.kind}</span>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{s.runs}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{pct(s.fallbackRate)}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{s.avgTokens ?? '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink-mute">
                    {s.review
                      ? t('draftOutcome', { edited: pct(s.review.editRate), rejected: pct(s.review.rejectionRate) })
                      : Object.entries(s.edges)
                          .map(([edge, n]) => `${edge} ${n}`)
                          .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {reviewStats.length > 0 && (
        <section className="md:col-span-2">
          <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('reviews')}</h3>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b-[1px] border-rule-soft text-left dark:border-rule-on-dark">
                <Th>{t('node')}</Th>
                <Th className="text-right">{t('unedited')}</Th>
                <Th className="text-right">{t('edited')}</Th>
                <Th className="text-right">{t('dismissed')}</Th>
                <Th className="text-right">{t('uneditedRate')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {reviewStats.map((s) => (
                <tr key={s.nodeId} className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
                  <td className="py-2 pr-4 font-mono text-xs">{s.nodeId}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{s.approvedUnedited}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{s.edited}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{s.dismissed}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{pct(s.uneditedRate)}</td>
                  <td className="py-2 pr-4 text-right">
                    {s.readyForAuto && <Pill tone="live">{t('readyForAuto')}</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="md:col-span-2">
        <h3 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">{t('nodes')}</h3>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b-[1px] border-rule-soft text-left dark:border-rule-on-dark">
              <Th>{t('node')}</Th>
              <Th className="text-right">{t('arrived')}</Th>
              <Th className="text-right">{t('waiting')}</Th>
              <Th>{t('edges')}</Th>
            </tr>
          </thead>
          <tbody>
            {report.nodes.map((n) => (
              <tr key={n.nodeId} className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
                <td className="py-2 pr-4 font-mono text-xs">
                  {n.nodeId} <span className="text-ink-label">{n.nodeType}</span>
                </td>
                <td className="py-2 pr-4 text-right font-mono text-xs">{n.arrived}</td>
                <td className="py-2 pr-4 text-right font-mono text-xs">{n.waitingNow}</td>
                <td className="py-2 pr-4 font-mono text-xs text-ink-mute">
                  {Object.entries(n.edges)
                    .map(([edge, count]) => `${edge} ${count}`)
                    .join(' · ') || '—'}
                  {report.messages[n.nodeId] &&
                    ` · ${Object.entries(report.messages[n.nodeId]!)
                      .map(([status, count]) => `${status} ${count}`)
                      .join(' · ')}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function VersionList({
  versions,
  onPublish,
}: {
  versions: JourneyVersionSummaryDto[];
  onPublish: (n: number) => void;
}) {
  const t = useTranslations('dashboard.journeys.versions');
  const format = useFormatter();
  return (
    <ol className="space-y-3">
      {versions.map((v) => (
        <li key={v.number} className="rounded-card border-[1px] border-rule-soft p-3 dark:border-rule-on-dark">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-ink dark:text-foreground">v{v.number}</span>
            {v.publishedAt ? (
              <Pill tone="live">{t('published', { at: format.dateTime(new Date(v.publishedAt), { dateStyle: 'medium' }) })}</Pill>
            ) : v.publishRequestedAt ? (
              <Pill tone="review">{t('awaiting')}</Pill>
            ) : (
              <Pill tone="draft">{t('draft')}</Pill>
            )}
            {v.validation && !v.validation.valid && (
              <span className="font-mono text-[10px] text-destructive">{t('errors', { count: v.validation.errors.length })}</span>
            )}
            {!v.publishedAt && (
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => onPublish(v.number)}>
                {t('review')}
              </Button>
            )}
          </div>
          {v.proposal?.hypothesis ? (
            <div className="mt-2 space-y-1 text-sm">
              <Pill tone="review">{t('proposed')}</Pill>
              <p className="text-ink dark:text-foreground">{v.proposal.hypothesis}</p>
              {v.proposal.rationale && <p className="whitespace-pre-line text-xs text-ink-mute">{v.proposal.rationale}</p>}
            </div>
          ) : (
            v.changeSummary && (
              <p className="mt-2 whitespace-pre-line font-mono text-[11px] text-ink-mute">{v.changeSummary}</p>
            )
          )}
        </li>
      ))}
    </ol>
  );
}

function StatusPill({ status }: { status: JourneyStatus }) {
  const t = useTranslations('dashboard.journeys.status');
  return (
    <Pill tone={status === 'live' ? 'live' : status === 'paused' ? 'review' : 'draft'} pulse={status === 'live'}>
      {t(status)}
    </Pill>
  );
}

function versionLabel(
  t: ReturnType<typeof useTranslations<'dashboard.journeys'>>,
  live: number | null,
  draft: number | null,
): string {
  const parts: string[] = [];
  if (live) parts.push(t('liveVersion', { version: live }));
  if (draft) parts.push(t('draftVersion', { version: draft }));
  return parts.join(' · ') || '—';
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="font-mono text-xs text-ink-mute">{label}</dt>
      <dd className="text-right font-mono text-xs">{value}</dd>
    </>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'pb-3 pr-4 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label',
        className,
      )}
    >
      {children}
    </th>
  );
}
