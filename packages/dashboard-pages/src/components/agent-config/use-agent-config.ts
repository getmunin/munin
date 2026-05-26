'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../../api';
import type { ApiError } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { useLoadGate } from '../../lib/use-load-gate';
import type { AgentConfigDto, ListModelsResult } from './types';

export interface UseAgentConfigResult {
  config: AgentConfigDto | null;
  loadError: ApiError | null;
  loadErrorMessage: string | null;
  hasLoadedOnce: boolean;
  retrying: boolean;
  retry: () => Promise<void>;
  models: ListModelsResult | null;
  setConfig: (cfg: AgentConfigDto) => void;
  setModels: (models: ListModelsResult) => void;
}

export function useAgentConfig(): UseAgentConfigResult {
  const t = useTranslations('agentSetup');
  const translate = useTranslateError();

  const [config, setConfig] = useState<AgentConfigDto | null>(null);
  const [models, setModels] = useState<ListModelsResult | null>(null);

  const load = useCallback(async () => {
    const cfg = await api<AgentConfigDto>('/v1/agent-config');
    setConfig(cfg);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  useEffect(() => {
    if (!config?.providerApiKeySet) return;
    void api<ListModelsResult>('/v1/agent-config/models')
      .then(setModels)
      .catch(() => undefined);
  }, [config?.providerApiKeySet]);

  const loadErrorMessage = loadError ? translate(loadError) || t('errors.load') : null;

  return {
    config,
    loadError,
    loadErrorMessage,
    hasLoadedOnce,
    retrying,
    retry,
    models,
    setConfig,
    setModels,
  };
}
