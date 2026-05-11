'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

/**
 * Tracks initial-load state for a page that fetches data on mount.
 *
 * Pages should call `tryLoad()` from an effect. The first failure becomes
 * `loadError`; once a load succeeds, `hasLoadedOnce` flips to `true` and
 * subsequent failures still update `loadError` but the page can choose to
 * keep rendering its last-good data instead of replacing the view.
 *
 * Auto-retries every 30s while `loadError` is set.
 */
export function useLoadGate(loader: () => Promise<void>) {
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const tryLoad = useCallback(async () => {
    try {
      await loaderRef.current();
      setLoadError(null);
      setHasLoadedOnce(true);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, []);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await tryLoad();
    } finally {
      setRetrying(false);
    }
  }, [tryLoad]);

  useEffect(() => {
    if (!loadError) return;
    const id = setInterval(() => {
      void retry();
    }, 30_000);
    return () => clearInterval(id);
  }, [loadError, retry]);

  return { loadError, hasLoadedOnce, retrying, tryLoad, retry };
}
