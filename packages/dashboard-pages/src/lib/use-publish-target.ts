'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SocialPublishTarget } from '../components/dashboard/queue-panes/social-actions';

export function useSocialPublishTargets(enabled: boolean) {
  const [targets, setTargets] = useState<SocialPublishTarget[] | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<SocialPublishTarget[]>('/v1/social/accounts/mine');
        if (!cancelled) setTargets(res ?? []);
      } catch {
        if (!cancelled) setTargets(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return targets;
}
