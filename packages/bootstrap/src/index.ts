/**
 * Conversational config framework for Munin apps.
 *
 * Each app declares an ordered list of BootstrapStep<T>. The agent calls
 * `bootstrap_status()` to learn what to ask next, then `bootstrap_answer()`
 * with the user's reply. State persists per (org, app) in `bootstrap_state`.
 */
export {
  defineStep,
  type BootstrapStep,
  type BootstrapStepCtx,
  type BootstrapAppKey,
} from './step.js';

export { BootstrapRunner, type BootstrapStatus } from './runner.js';
