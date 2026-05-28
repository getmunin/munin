'use client';

import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { AuthProviders } from './fetch-auth-providers';

export function useAuthProviders(): AuthProviders | null {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<AuthProviders>('/v1/auth/providers')
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch((err) => {
        console.warn('[auth-providers] fetch failed', err);
        if (!cancelled) setProviders({ google: false, github: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return providers;
}
