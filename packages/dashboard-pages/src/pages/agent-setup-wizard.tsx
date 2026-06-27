'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link } from '../i18n-navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, Hero } from '@getmunin/ui';
import type { WebImportProgress } from '@getmunin/types';
import { useActiveMembership } from '../auth/use-active-role';
import { useAgentConfig } from '../components/agent-config/use-agent-config';
import { OrgNameCard } from '../components/agent-config/org-name-card';
import { ProviderCard } from '../components/agent-config/provider-card';
import { ModelsCard } from '../components/agent-config/models-card';
import { WebsiteImportCard } from '../components/agent-config/website-import-card';
import { hasOauthAuthorizeParams } from '../auth/post-signin-redirect';
import { useTranslateError } from '../i18n/translate-error';
import type { AgentConfigDto, ProviderPreset } from '../components/agent-config/types';
import { api } from '../api';

type Step = 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS = 5;

interface AgentSetupWizardProps {
  extraPresets?: ProviderPreset[];
  defaultPresetId?: string;
  providerLede?: string;
}

export function AgentSetupWizard({
  extraPresets,
  defaultPresetId,
  providerLede,
}: AgentSetupWizardProps = {}) {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const { config, loadErrorMessage, models, setConfig, setModels } = useAgentConfig();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [step, setStep] = useState<Step | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState<string | null>(null);

  useEffect(() => {
    if (step !== null) return;
    if (config === null) return;
    if (membershipLoading) return;
    const orgNamed = membership ? membership.name.trim().length > 0 : false;
    if (!orgNamed) {
      setStep(1);
    } else if (!config.providerApiKeySet) {
      setStep(2);
    } else {
      setStep(5);
    }
  }, [config, step, membership, membershipLoading]);

  if (loadErrorMessage) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{loadErrorMessage}</CardContent>
        </Card>
      </main>
    );
  }

  if (config === null || step === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </main>
    );
  }

  const managedPreset = (extraPresets ?? []).find((p) => p.managed);
  const isManaged = !!managedPreset && !config.providerApiKeySet;
  const managedModelsResult =
    isManaged && (managedPreset?.models?.length ?? 0) > 0
      ? { supported: true, models: managedPreset?.models ?? [] }
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Hero
        eyebrow={step === TOTAL_STEPS ? undefined : t('wizard.stepEyebrow', { step, total: TOTAL_STEPS })}
        title={
          <>
            {t('titlePrefix')} <em>{t('titleAccent')}</em>
          </>
        }
        lede={t('lede')}
      />

      <div className="mt-6 flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              if (n < step) setStep(n as Step);
            }}
            disabled={n >= step}
            className={
              'h-2 w-12 rounded-full transition-colors ' +
              (n === step
                ? 'bg-cobalt'
                : n < step
                  ? 'bg-cobalt/40 cursor-pointer'
                  : 'bg-rule-soft cursor-default')
            }
            aria-label={`Step ${n}`}
          />
        ))}
      </div>

      <div className="mt-8 space-y-6">
        {step === 1 && <OrgNameCard bare onSaved={() => setStep(2)} />}

        {step === 2 && (
          <ProviderCard
            config={config}
            bare
            saveLabel={t('wizard.saveAndContinue')}
            onBack={() => setStep(1)}
            extraPresets={extraPresets}
            defaultPresetId={defaultPresetId}
            lede={providerLede}
            onSaved={(updated, result) => {
              setConfig(updated);
              setModels(result);
              setStep(3);
            }}
          />
        )}

        {step === 3 && (
          <ModelsCard
            config={config}
            bare
            models={managedModelsResult ?? models}
            managed={isManaged}
            saveLabel={t('wizard.saveAndContinue')}
            extraActions={
              <Button type="button" variant="ghost" onClick={() => setStep(2)}>
                {tCommon('back')}
              </Button>
            }
            onSaved={(updated) => {
              setConfig(updated);
              setStep(4);
            }}
          />
        )}

        {step === 4 && (
          <WebsiteImportCard
            bare
            onEnqueued={(id, url) => {
              setImportJobId(id);
              setImportUrl(url);
              setStep(5);
            }}
            onSkip={() => setStep(5)}
            onBack={() => setStep(3)}
          />
        )}

        {step === 5 && (
          <Suspense fallback={null}>
            <ReadyCard
              config={config}
              isManaged={isManaged}
              managedProviderName={managedPreset?.name}
              importJobId={importJobId}
              importUrl={importUrl}
              onBack={() => setStep(4)}
            />
          </Suspense>
        )}
      </div>
    </main>
  );
}

interface ReadyCardProps {
  config: AgentConfigDto;
  isManaged: boolean;
  managedProviderName?: string;
  importJobId: string | null;
  importUrl: string | null;
  onBack: () => void;
}

function ReadyCard({
  config,
  isManaged,
  managedProviderName,
  importJobId,
  importUrl,
  onBack,
}: ReadyCardProps) {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const searchParams = useSearchParams();
  const oauthContinueHref = useMemo(() => {
    if (!searchParams) return null;
    if (!hasOauthAuthorizeParams(searchParams)) return null;
    return `/dashboard/oauth/consent?${searchParams.toString()}`;
  }, [searchParams]);

  const code = (chunks: ReactNode) => (
    <code className="font-mono text-[13px] text-ink-soft dark:text-foreground/80">{chunks}</code>
  );
  const lines: ReactNode[] = [
    isManaged && managedProviderName
      ? t.rich('wizard.checklist.providerManaged', { name: managedProviderName, code })
      : t.rich('wizard.checklist.provider', { url: shortHost(config.providerBaseUrl), code }),
    t.rich('wizard.checklist.fast', { model: config.fastModel, code }),
    t.rich('wizard.checklist.smart', { model: config.smartModel ?? config.fastModel, code }),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl text-ink dark:text-foreground">
          {t('wizard.readyTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('wizard.readyLede')}</p>
      </div>
      <ul className="space-y-2.5 text-sm">
        {lines.map((line, i) => (
          <li key={i} className="flex items-baseline gap-2.5">
            <span aria-hidden className="text-cobalt">✓</span>
            <span className="text-ink dark:text-foreground">{line}</span>
          </li>
        ))}
      </ul>
      {importJobId && <WebsiteImportStatus jobId={importJobId} initialUrl={importUrl} />}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {oauthContinueHref ? (
          <Button render={<Link href={oauthContinueHref} />}>{t('wizard.cta.continue')}</Button>
        ) : (
          <Button render={<Link href="/dashboard" />}>{t('wizard.cta.goToDashboard')}</Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          {tCommon('back')}
        </Button>
      </div>
    </div>
  );
}

type JobStatus = 'pending' | 'done' | 'failed' | 'dead' | 'failed_retryable';

const IMPORT_JOB_URI = 'task://web/scrape-website';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90;

interface CuratorJobDto {
  id: string;
  status: JobStatus;
  userPrompt: string;
  lastError: string | null;
  lastReplyText: string | null;
  lastToolCalls: number | null;
  createdAt: string;
  doneAt: string | null;
  progress: WebImportProgress | null;
}

const MONO_LABEL = 'font-mono text-[11px] uppercase tracking-[0.14em]';

function WebsiteImportStatus({ jobId, initialUrl }: { jobId: string; initialUrl: string | null }) {
  const t = useTranslations('agentSetup.websiteImport.status');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [activeJobId, setActiveJobId] = useState(jobId);
  const [job, setJob] = useState<CuratorJobDto | null>(null);
  const [stopped, setStopped] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    setJob(null);
    setStopped(false);

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await api<CuratorJobDto>(`/v1/curator/jobs/${activeJobId}`);
        if (cancelled) return;
        setJob(res);
        if (res.status !== 'pending' || attempts >= MAX_POLL_ATTEMPTS) {
          setStopped(true);
          return;
        }
      } catch (err) {
        console.debug('[agent-setup] curator job poll failed', { activeJobId, attempts, err });
        if (attempts >= MAX_POLL_ATTEMPTS) {
          setStopped(true);
          return;
        }
      }
      window.setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [activeJobId]);

  const status: JobStatus = job?.status ?? 'pending';
  const url = job?.userPrompt ?? initialUrl;
  const host = url ? shortHost(url) : '';
  const failed = status === 'failed' || status === 'dead' || status === 'failed_retryable';
  const done = status === 'done';

  async function retry(): Promise<void> {
    if (!url || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await api<{ job: { id: string } }>('/v1/curator/jobs', {
        method: 'POST',
        body: JSON.stringify({
          jobUri: IMPORT_JOB_URI,
          userPrompt: url,
          dedupeKey: `onboarding-import-retry:${url}:${Date.now()}`,
          maxAttempts: 3,
        }),
      });
      setActiveJobId(res.job.id);
    } catch (err) {
      setRetryError(translate(err) || tCommon('retry'));
    } finally {
      setRetrying(false);
    }
  }

  if (failed) {
    const detail = cleanImportError(job?.lastError ?? null);
    return (
      <div className="border border-rule-soft border-t-[3px] border-t-rule px-5 py-4">
        <span className={`${MONO_LABEL} text-ink dark:text-foreground`}>{t('failedLabel')}</span>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft dark:text-foreground/80">
          {t('failedSummary', { host })}
        </p>
        {detail && (
          <p className="mt-2 break-words font-mono text-[11px] text-ink-mute">{detail}</p>
        )}
        <div className="mt-3.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying || !url}
            className="border border-rule px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink transition-colors duration-base hover:bg-ink hover:text-paper disabled:opacity-50 dark:text-foreground"
          >
            {retrying ? tCommon('saving') : t('retry')}
          </button>
          {retryError && <span className="text-xs text-destructive">{retryError}</span>}
        </div>
      </div>
    );
  }

  if (done) {
    const count = parseImportedCount(job?.lastReplyText ?? null) ?? job?.lastToolCalls ?? 0;
    const duration = importDuration(job?.createdAt ?? null, job?.doneAt ?? null);
    return (
      <div className="border border-rule-soft px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`${MONO_LABEL} text-cobalt`}>✓ {t('doneLabel')}</span>
          <span className="font-mono text-[11px] text-ink-mute">{t('pagesChip', { count })}</span>
        </div>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft dark:text-foreground/80">
          {count <= 0
            ? t('doneEmpty', { host })
            : duration
              ? t('doneSummary', { count, host, duration })
              : t('doneSummaryNoTime', { count, host })}
        </p>
      </div>
    );
  }

  const progress = job?.progress ?? null;
  const hasTotal = progress !== null && progress.total > 0;
  const pct = hasTotal ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <div className="border border-rule-soft px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`${MONO_LABEL} text-cobalt`}>{t('readingLabel')}</span>
        {hasTotal && (
          <span className="font-mono text-[11px] text-ink-mute">
            {t('counter', { done: progress.done, total: progress.total })}
          </span>
        )}
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-mute">
        {stopped ? t('stillRunning') : t('reading', { host })}
      </p>
      <div className="mt-3.5 h-[3px] overflow-hidden bg-rule-soft">
        {hasTotal ? (
          <div
            className="h-[3px] bg-cobalt transition-all duration-slow"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-[3px] w-1/3 bg-cobalt animate-import-indeterminate" />
        )}
      </div>
      {progress && progress.recentPaths.length > 0 && (
        <div className="mt-2.5 truncate font-mono text-[10px] tracking-[0.04em] text-ink-mute">
          {progress.recentPaths.join(' · ')} …
        </div>
      )}
    </div>
  );
}

function cleanImportError(raw: string | null): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/^(agent_error|provider_error)(_[a-z0-9]+)?:\s*/i, '').trim();
  return stripped.slice(0, 200) || null;
}

function parseImportedCount(replyText: string | null): number | null {
  if (!replyText) return null;
  const m = /Imported (\d+) document/.exec(replyText);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

function importDuration(createdAt: string | null, doneAt: string | null): number | null {
  if (!createdAt || !doneAt) return null;
  const ms = Date.parse(doneAt) - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.round(ms / 1000));
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch (err) {
    console.debug('[agent-setup] could not parse URL, returning raw', url, err);
    return url;
  }
}
