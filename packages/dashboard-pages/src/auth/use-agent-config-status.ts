'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';

interface AgentConfigStatusDto {
  providerApiKeySet: boolean;
}

export function useAgentConfigStatus(): {
  configured: boolean | null;
  loading: boolean;
  error: string | null;
} {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<AgentConfigStatusDto>('/v1/agent-config')
      .then((dto) => {
        if (cancelled) return;
        setConfigured(dto.providerApiKeySet);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'unknown error');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { configured, loading, error };
}
