'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import type { ProviderPreset } from '../components/agent-config/types';
import { useAgentConfig } from '../components/agent-config/use-agent-config';
import { ProviderCard } from '../components/agent-config/provider-card';
import { ModelsCard } from '../components/agent-config/models-card';
import { IdentityCard } from '../components/assistants/identity-card';
import { useAssistant } from '../components/assistants/use-assistant';
import { LoadFailed } from '../components/load-failed';
import { Skeleton } from '../components/skeleton';
import { SettingsColumn, SettingsSection } from '../components/settings/scaffold';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

interface AiSettingsPageProps {
  extraPresets?: ProviderPreset[];
  defaultPresetId?: string;
  providerLede?: string;
  slot?: ReactNode;
}

export function AiSettingsPage({
  extraPresets,
  defaultPresetId,
  providerLede,
  slot,
}: AiSettingsPageProps = {}) {
  const t = useTranslations('agentSetup');
  const tList = useTranslations('assistants.list');

  const {
    config,
    loadError: configError,
    hasLoadedOnce: configLoaded,
    retrying,
    retry,
    models,
    setConfig,
    setModels,
  } = useAgentConfig();
  const { assistant, setAssistant } = useAssistant();

  const buildLoadFailedProps = useSettingsLoadFailedProps();

  if (configError && !configLoaded) {
    return (
      <LoadFailed {...buildLoadFailedProps('ai', configError, () => void retry(), retrying)} />
    );
  }

  const managedPreset = (extraPresets ?? []).find((p) => p.managed);
  const isManaged = !!managedPreset && config != null && !config.providerApiKeySet;
  const managedModelsResult =
    isManaged && (managedPreset?.models?.length ?? 0) > 0
      ? { supported: true, models: managedPreset?.models ?? [] }
      : null;

  return (
    <SettingsColumn>
      <Hero
        eyebrow={t('settings.eyebrow')}
        title={t.rich('settings.title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('settings.lede')}
      />

      {slot}

      <SettingsSection
        title={tList('persona.title')}
        meta={tList('persona.meta')}
        help={tList('persona.blurb')}
      >
        {assistant ? (
          <IdentityCard headless assistant={assistant} onSaved={setAssistant} />
        ) : (
          <SectionSkeleton />
        )}
      </SettingsSection>

      <SettingsSection
        title={tList('provider.title')}
        meta={tList('provider.meta')}
        help={providerLede ?? tList('provider.blurb')}
      >
        {config ? (
          <ProviderCard
            headless
            config={config}
            extraPresets={extraPresets}
            defaultPresetId={defaultPresetId}
            lede={providerLede}
            onSaved={(updated, result) => {
              setConfig(updated);
              setModels(result);
            }}
          />
        ) : (
          <SectionSkeleton />
        )}
      </SettingsSection>

      <SettingsSection
        title={tList('models.title')}
        meta={tList('models.meta')}
        help={tList('models.blurb')}
      >
        {config ? (
          <ModelsCard
            headless
            config={config}
            models={managedModelsResult ?? models}
            managed={isManaged}
            onSaved={setConfig}
          />
        ) : (
          <SectionSkeleton />
        )}
      </SettingsSection>
    </SettingsColumn>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-9 w-full max-w-[420px]" />
      <Skeleton className="h-9 w-24" />
    </div>
  );
}
