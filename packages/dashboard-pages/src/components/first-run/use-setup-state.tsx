'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../../api';
import { usePathname } from '../../i18n-navigation';
import { useRealtime, type SubscriptionChannel } from '../../realtime';
import { toSetupSnapshot, type SetupSnapshot, type SetupStateDto } from './setup-snapshot';

export type {
  SetupChannel,
  SetupChannelType,
  SetupSnapshot,
  SetupStage,
} from './setup-snapshot';

export interface SetupState extends SetupSnapshot {
  loading: boolean;
  isFirstRun: boolean;
  reload: () => Promise<void>;
}

const REFRESH_PREFIXES = ['conversation.', 'kb.'];

const REVALIDATE_AFTER_MS = 2_000;

const ORG_SUBSCRIPTION: readonly SubscriptionChannel[] = [{ channel: 'org' }];

const SetupStateContext = createContext<SetupState | null>(null);

export function SetupStateProvider({ children }: { children: ReactNode }) {
  const value = useFetchSetupState(true);
  return <SetupStateContext.Provider value={value}>{children}</SetupStateContext.Provider>;
}

export function useSetupState(): SetupState {
  const shared = useContext(SetupStateContext);
  const own = useFetchSetupState(shared === null);
  return shared ?? own;
}

function useFetchSetupState(enabled: boolean): SetupState {
  const [dto, setDto] = useState<SetupStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const startedAt = useRef(0);
  const pathname = usePathname();

  const load = useCallback(async () => {
    if (!enabled) return;
    startedAt.current = Date.now();
    await api<SetupStateDto>('/v1/overview/setup')
      .then(setDto)
      .catch(() => setDto(null))
      .finally(() => setLoading(false));
  }, [enabled]);

  const revalidate = useCallback(() => {
    if (Date.now() - startedAt.current < REVALIDATE_AFTER_MS) return;
    void load();
  }, [load]);

  useEffect(() => {
    revalidate();
  }, [revalidate, pathname]);

  useRealtime(ORG_SUBSCRIPTION, (event) => {
    if (REFRESH_PREFIXES.some((prefix) => event.type.startsWith(prefix))) revalidate();
  });

  return useMemo(() => {
    const snapshot = toSetupSnapshot(dto);
    return {
      ...snapshot,
      loading,
      isFirstRun: snapshot.known && !loading && snapshot.stage !== 'active',
      reload: load,
    };
  }, [dto, loading, load]);
}
