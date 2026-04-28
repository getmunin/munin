import { z } from 'zod';

/**
 * Conversational config framework: each app declares an ordered list of
 * BootstrapSteps. State persists per (org, app) in `bootstrap_state`.
 *
 * Implementation fills in defineStep, runner, and the two universal MCP tools
 * `bootstrap_status` / `bootstrap_answer` in M0.7.
 */

export interface BootstrapStep<T = unknown> {
  id: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Returning false skips this step. */
  shouldRun?: (answers: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Side-effect that applies the answer (e.g. creates a row). */
  apply: (value: T, ctx: { orgId: string }) => Promise<void>;
}

export const PLACEHOLDER = 'to be implemented in M0.7';
