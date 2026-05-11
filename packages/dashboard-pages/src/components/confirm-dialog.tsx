'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@getmunin/ui';
import { dialogButtonClass, dialogFooterClass } from '../lib/dialog-style';

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}

type Resolver = (value: boolean) => void;

interface ConfirmState extends ConfirmOptions {
  resolve: Resolver;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolverRef = useRef<Resolver | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((decision: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    resolver?.(decision);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={state !== null}
        onOpenChange={(next) => {
          if (!next) close(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {state && (
            <>
              <DialogHeader className="border-b-0 pb-0 mb-0">
                <DialogTitle>{state.title}</DialogTitle>
                {state.message ? (
                  <DialogDescription>{state.message}</DialogDescription>
                ) : null}
              </DialogHeader>
              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => close(false)}
                >
                  {state.cancelLabel}
                </Button>
                <Button
                  type="button"
                  variant={state.destructive ? 'destructive' : 'accent'}
                  className={dialogButtonClass}
                  onClick={() => close(true)}
                  autoFocus
                >
                  {state.confirmLabel}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within <ConfirmDialogProvider>');
  }
  return ctx;
}
