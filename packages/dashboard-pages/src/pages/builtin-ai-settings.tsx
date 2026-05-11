'use client';

import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { useAgentConfig } from '../components/agent-config/use-agent-config';
import { ProviderCard } from '../components/agent-config/provider-card';
import { ModelsCard } from '../components/agent-config/models-card';
import { LoadFailed } from '../components/load-failed';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

export function BuiltinAiSettingsPage() {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const { config, loadError, hasLoadedOnce, retrying, retry, models, setConfig, setModels } =
    useAgentConfig();
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('builtin-ai', loadError, () => void retry(), retrying)}
      />
    );
  }

  return (
    <>
      <Hero
        eyebrow={t('settings.eyebrow')}
        title={t.rich('settings.title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('settings.lede')}
      />

      {config === null && (
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
