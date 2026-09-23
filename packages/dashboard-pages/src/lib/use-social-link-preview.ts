'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SocialLinkPreview } from '../components/dashboard/queue-panes/social-preview';

export function useSocialLinkPreview(
  draftId: string,
  enabled: boolean,
): SocialLinkPreview | null | undefined {
  const [loaded, setLoaded] = useState<{ id: string; preview: SocialLinkPreview | null } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<SocialLinkPreview>(`/v1/social/drafts/${draftId}/link-preview`);
        if (!cancelled) setLoaded({ id: draftId, preview: res ?? null });
      } catch {
        if (!cancelled) setLoaded({ id: draftId, preview: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, enabled]);

  return loaded?.id === draftId ? loaded.preview : undefined;
}
