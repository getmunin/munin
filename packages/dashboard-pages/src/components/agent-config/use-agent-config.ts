'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import type { AgentConfigDto, ListModelsResult } from './types';

export interface UseAgentConfigResult {
  config: AgentConfigDto | null;
  loadError: string | null;
  models: ListModelsResult | null;
  setConfig: (cfg: AgentConfigDto) => void;
  setModels: (models: ListModelsResult) => void;
}

export function useAgentConfig(): UseAgentConfigResult {
  const t = useTranslations('agentSetup');
  const translate = useTranslateError();

  const [config, setConfig] = useState<AgentConfigDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [models, setModels] = useState<ListModelsResult | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const cfg = await api<AgentConfigDto>('/api/v1/agent-config');
      setConfig(cfg);
    } catch (err) {
      setLoadError(translate(err) || t('errors.load'));
    }
  }, [t, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!config?.providerApiKeySet) return;
    void api<ListModelsResult>('/api/v1/agent-config/models')
      .then(setModels)
      .catch(() => undefined);
  }, [config?.providerApiKeySet]);

  return { config, loadError, models, setConfig, setModels };
}
