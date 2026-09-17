'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SocialPublishTarget } from '../components/dashboard/queue-panes/social-actions';

export function useSocialPublishTarget(enabled: boolean) {
  const [target, setTarget] = useState<SocialPublishTarget | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<SocialPublishTarget | null>('/v1/social/accounts/mine');
        if (!cancelled) setTarget(res ?? null);
      } catch {
        if (!cancelled) setTarget(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return target;
}
