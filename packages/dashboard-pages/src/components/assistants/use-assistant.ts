'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../api';
import { useLoadGate } from '../../lib/use-load-gate';
import type { AssistantDto } from './types';

export interface UseAssistantResult {
  assistant: AssistantDto | null;
  loadError: ApiError | null;
  hasLoadedOnce: boolean;
  retrying: boolean;
  retry: () => Promise<void>;
  setAssistant: (a: AssistantDto) => void;
}

export function useAssistant(): UseAssistantResult {
  const [assistant, setAssistant] = useState<AssistantDto | null>(null);

  const load = useCallback(async () => {
    const a = await api<AssistantDto>('/v1/assistants/me');
    setAssistant(a);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  return { assistant, loadError, hasLoadedOnce, retrying, retry, setAssistant };
}
