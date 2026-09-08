'use client';

import { resolveFirstRunView, type FirstRunGateOptions, type FirstRunView } from './first-run-view';
import { useSetupState, type SetupState } from './use-setup-state';

export interface FirstRunGate {
  view: FirstRunView;
  setup: SetupState;
}

export function useFirstRunGate(options: FirstRunGateOptions = {}): FirstRunGate {
  const setup = useSetupState();
  return { view: resolveFirstRunView(setup, options), setup };
}
