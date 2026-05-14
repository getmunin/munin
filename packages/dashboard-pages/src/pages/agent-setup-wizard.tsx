'use client';

import { useEffect, useState } from 'react';
import { Link } from '../i18n-navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, Hero } from '@getmunin/ui';
import { useActiveMembership } from '../auth/use-active-role';
import { useAgentConfig } from '../components/agent-config/use-agent-config';
import { OrgNameCard } from '../components/agent-config/org-name-card';
import { ProviderCard } from '../components/agent-config/provider-card';
import { ModelsCard } from '../components/agent-config/models-card';
import { WebsiteImportCard } from '../components/agent-config/website-import-card';
import type { AgentConfigDto } from '../components/agent-config/types';
import { api } from '../api';

type Step = 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS = 5;

export function AgentSetupWizard() {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const { config, loadErrorMessage, models, setConfig, setModels } = useAgentConfig();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [step, setStep] = useState<Step | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);

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
        {step === 1 && <OrgNameCard onSaved={() => setStep(2)} />}

        {step === 2 && (
          <ProviderCard
            config={config}
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
            models={models}
            saveLabel={t('wizard.saveAndContinue')}
            extraActions={
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
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
            onEnqueued={(id) => {
              setImportJobId(id);
              setStep(5);
            }}
            onSkip={() => setStep(5)}
            onBack={() => setStep(3)}
          />
        )}

        {step === 5 && (
          <ReadyCard config={config} importJobId={importJobId} onBack={() => setStep(4)} />
        )}
      </div>
    </main>
  );
}

interface ReadyCardProps {
  config: AgentConfigDto;
  importJobId: string | null;
  onBack: () => void;
}

function ReadyCard({ config, importJobId, onBack }: ReadyCardProps) {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');

  const lines: string[] = [
    t('wizard.checklist.provider', { url: shortHost(config.providerBaseUrl) }),
    t('wizard.checklist.fast', { model: config.fastModel }),
    t('wizard.checklist.smart', { model: config.smartModel ?? config.fastModel }),
  ];

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <div>
          <h2 className="font-serif text-2xl text-ink dark:text-foreground">
            {t('wizard.readyTitle')}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('wizard.readyLede')}</p>
        </div>
        <ul className="space-y-2 text-sm">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span aria-hidden className="text-cobalt">✓</span>
              <span className="text-ink dark:text-foreground">{line}</span>
            </li>
          ))}
        </ul>
        {importJobId && <WebsiteImportStatus jobId={importJobId} />}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button render={<Link href="/dashboard" />}>
            {t('wizard.cta.goToDashboard')}
          </Button>
          <Button
            variant="outline"
            render={<Link href="/dashboard/settings/assistants" />}
          >
            {t('wizard.cta.tweakSettings')}
          </Button>
          <Button variant="ghost" onClick={onBack}>
            {tCommon('back')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type JobStatus = 'pending' | 'done' | 'failed' | 'dead';

interface CuratorJobDto {
  id: string;
  status: JobStatus;
  lastError: string | null;
}

function WebsiteImportStatus({ jobId }: { jobId: string }) {
  const t = useTranslations('agentSetup.websiteImport.status');
  const [job, setJob] = useState<CuratorJobDto | null>(null);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 36;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await api<CuratorJobDto>(`/api/v1/curation/jobs/${jobId}`);
        if (cancelled) return;
        setJob(res);
        if (res.status !== 'pending' || attempts >= MAX_ATTEMPTS) {
          setStopped(true);
          return;
        }
      } catch (err) {
        console.debug('[agent-setup] curator job poll failed', { jobId, attempts, err });
        if (attempts >= MAX_ATTEMPTS) {
          setStopped(true);
          return;
        }
      }
      window.setTimeout(() => {
        void tick();
      }, 5000);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const status: JobStatus = job?.status ?? 'pending';
  const message =
    status === 'done'
      ? t('done')
      : status === 'failed' || status === 'dead'
        ? t('failed')
        : stopped
          ? t('stillRunning')
          : t('running');

  return (
    <div className="rounded-md border border-rule-soft px-4 py-3 text-sm">
      <p className="font-medium text-ink dark:text-foreground">{t('label')}</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
    </div>
  );
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch (err) {
    console.debug('[agent-setup] could not parse URL, returning raw', url, err);
    return url;
  }
}
