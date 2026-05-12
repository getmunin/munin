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
import type { AgentConfigDto } from '../components/agent-config/types';

type Step = 1 | 2 | 3 | 4;
const TOTAL_STEPS = 4;

export function AgentSetupWizard() {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const { config, loadErrorMessage, models, setConfig, setModels } = useAgentConfig();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const [step, setStep] = useState<Step | null>(null);

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
      setStep(4);
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
        {[1, 2, 3, 4].map((n) => (
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

        {step === 4 && <ReadyCard config={config} onBack={() => setStep(3)} />}
      </div>
    </main>
  );
}

interface ReadyCardProps {
  config: AgentConfigDto;
  onBack: () => void;
}

function ReadyCard({ config, onBack }: ReadyCardProps) {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');

  const lines: string[] = [
    t('wizard.checklist.provider', { url: shortHost(config.providerBaseUrl) }),
    t('wizard.checklist.chat', { model: config.chatModel }),
    t('wizard.checklist.curator', { model: config.curatorModel ?? config.chatModel }),
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
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button render={<Link href="/dashboard" />}>
            {t('wizard.cta.goToDashboard')}
          </Button>
          <Button
            variant="outline"
            render={<Link href="/dashboard/settings/builtin-ai" />}
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

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch (err) {
    console.debug('[agent-setup] could not parse URL, returning raw', url, err);
    return url;
  }
}
