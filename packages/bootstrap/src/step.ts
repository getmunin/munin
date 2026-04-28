import type { z } from 'zod';

/** App key matches the `bootstrap_state.app_key` enum: kb / desk / crm / ... */
export type BootstrapAppKey = string;

export interface BootstrapStepCtx {
  /** Org being bootstrapped. */
  orgId: string;
  /** All previously-collected answers, keyed by step id. */
  answers: Record<string, unknown>;
}

/**
 * One question in a conversational config flow.
 *
 * The runtime asks the agent `prompt`, validates the reply against `schema`,
 * runs `apply` (which performs side effects — create rows, write config).
 *
 * `shouldRun` lets you skip a step based on prior answers (e.g. "skip
 * embeddings provider question if user said 'no semantic search'").
 */
export interface BootstrapStep<T = unknown> {
  id: string;
  prompt: string;
  schema: z.ZodType<T>;
  shouldRun?: (ctx: BootstrapStepCtx) => boolean | Promise<boolean>;
  apply: (value: T, ctx: BootstrapStepCtx) => Promise<void> | void;
}

/** Tiny helper for step definition with Zod inference. */
export function defineStep<T>(step: BootstrapStep<T>): BootstrapStep<T> {
  return step;
}
