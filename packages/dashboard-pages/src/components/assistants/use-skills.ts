'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../api';
import { useLoadGate } from '../../lib/use-load-gate';
import type { SkillDto } from './types';

export interface UseSkillsResult {
  skills: SkillDto[] | null;
  loadError: ApiError | null;
  hasLoadedOnce: boolean;
  retrying: boolean;
  retry: () => Promise<void>;
}

export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<SkillDto[] | null>(null);

  const load = useCallback(async () => {
    const list = await api<SkillDto[]>('/api/v1/skills');
    setSkills(list);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  return { skills, loadError, hasLoadedOnce, retrying, retry };
}
