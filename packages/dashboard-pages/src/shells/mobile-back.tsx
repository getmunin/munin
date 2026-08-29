'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface MobileBackAction {
  label: string;
  title?: string;
  meta?: string;
  onBack: () => void;
}

interface MobileBackContextValue {
  action: MobileBackAction | null;
  setAction: (action: MobileBackAction | null) => void;
}

const MobileBackContext = createContext<MobileBackContextValue | null>(null);

export function MobileBackProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<MobileBackAction | null>(null);
  return (
    <MobileBackContext.Provider value={{ action, setAction }}>
      {children}
    </MobileBackContext.Provider>
  );
}

export function useMobileBackAction(): MobileBackAction | null {
  return useContext(MobileBackContext)?.action ?? null;
}

export function useProvideMobileBack(action: MobileBackAction | null): void {
  const setAction = useContext(MobileBackContext)?.setAction;
  useEffect(() => {
    if (!setAction) return;
    setAction(action);
    return () => setAction(null);
  }, [setAction, action]);
}
