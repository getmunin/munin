import type { SetupState } from './use-setup-state';

export type FirstRunView = 'loading' | 'firstRun' | 'content';

export interface FirstRunGateOptions {
  firstRun?: (setup: SetupState) => boolean | null;
  content?: boolean;
}

export function resolveFirstRunView(
  setup: SetupState,
  options: FirstRunGateOptions = {},
): FirstRunView {
  if (setup.loading) return 'loading';

  if (setup.isFirstRun) {
    const narrowed = options.firstRun ? options.firstRun(setup) : true;
    if (narrowed === null) return 'loading';
    if (narrowed) return 'firstRun';
  }

  return options.content === false ? 'loading' : 'content';
}
