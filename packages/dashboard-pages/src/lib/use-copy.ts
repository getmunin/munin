'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from './clipboard';

export const COPY_RESET_MS = 1500;

export interface CopyController {
  copied: boolean;
  copy: (value: string) => void;
}

export function useCopy(resetMs: number = COPY_RESET_MS): CopyController {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    (value: string) => {
      void copyText(value).then((ok) => {
        if (!ok) return;
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      });
    },
    [resetMs],
  );

  return { copied, copy };
}
