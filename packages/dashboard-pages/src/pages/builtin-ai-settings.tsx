'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, Hero } from '@getmunin/ui';
import { useAgentConfig } from '../components/agent-config/use-agent-config';
import { ProviderCard } from '../components/agent-config/provider-card';
import { ModelsCard } from '../components/agent-config/models-card';

export function BuiltinAiSettingsPage() {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const { config, loadError, models, setConfig, setModels } = useAgentConfig();

  return (
    <>
      <Hero title={t('settings.title')} lede={t('settings.lede')} />

      {loadError && (
        <Card className="mt-6">
          <CardContent className="py-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      )}

      {config === null && !loadError && (
        <p className="mt-6 text-sm text-muted-foreground">{tCommon('loading')}</p>
      )}

      {config && (
        <div className="mt-8 space-y-6">
          <ProviderCard
            config={config}
            onSaved={(updated, result) => {
              setConfig(updated);
              setModels(result);
            }}
          />
          <ModelsCard config={config} models={models} onSaved={setConfig} />
        </div>
      )}
    </>
  );
}
