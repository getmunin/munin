import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import type { BootstrapStep, BootstrapStepCtx } from './step.js';

export interface BootstrapStatus {
  appKey: string;
  completed: boolean;
  /** ID of the next step to answer, or null if all done. */
  nextStepId: string | null;
  /** Human-friendly prompt for the next step. */
  nextPrompt: string | null;
  /** Step IDs already completed. */
  completedSteps: string[];
  /** Total step count (for progress UX). */
  totalSteps: number;
}

/**
 * Drives a bootstrap flow for one org/app.
 *
 * Used by the two universal MCP tools (registered per app):
 *   - bootstrap_status() → BootstrapStatus
 *   - bootstrap_answer(stepId, value) → BootstrapStatus (post-apply)
 *
 * The runner reads/writes `bootstrap_state` from the current request
 * context's transaction-scoped Db, so its writes commit atomically with
 * any side effects in the step's `apply()`.
 */
export class BootstrapRunner {
  constructor(
    public readonly appKey: string,
    public readonly steps: ReadonlyArray<BootstrapStep>,
  ) {}

  async status(): Promise<BootstrapStatus> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const state = await this.loadState(orgId);
    const completed = new Set(state.completedSteps);

    let nextStep: BootstrapStep | null = null;
    for (const step of this.steps) {
      if (completed.has(step.id)) continue;
      const ctxForStep: BootstrapStepCtx = { orgId, answers: state.answers };
      const should = step.shouldRun ? await step.shouldRun(ctxForStep) : true;
      if (!should) {
        completed.add(step.id);
        continue;
      }
      nextStep = step;
      break;
    }

    const allDone = nextStep === null;
    return {
      appKey: this.appKey,
      completed: allDone,
      nextStepId: nextStep?.id ?? null,
      nextPrompt: nextStep?.prompt ?? null,
      completedSteps: Array.from(completed),
      totalSteps: this.steps.length,
    };
  }

  async answer(stepId: string, rawValue: unknown): Promise<BootstrapStatus> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Unknown bootstrap step: ${stepId}`);

    const value = step.schema.parse(rawValue);
    const state = await this.loadState(orgId);
    const stepCtx: BootstrapStepCtx = { orgId, answers: state.answers };

    await step.apply(value, stepCtx);

    const newAnswers = { ...state.answers, [stepId]: value };
    const newCompleted = state.completedSteps.includes(stepId)
      ? state.completedSteps
      : [...state.completedSteps, stepId];

    await ctx.db
      .insert(schema.bootstrapState)
      .values({
        orgId,
        appKey: this.appKey,
        completedSteps: newCompleted,
        answers: newAnswers,
        completedAt: newCompleted.length === this.steps.length ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [schema.bootstrapState.orgId, schema.bootstrapState.appKey],
        set: {
          completedSteps: newCompleted,
          answers: newAnswers,
          completedAt: newCompleted.length === this.steps.length ? new Date() : null,
          updatedAt: new Date(),
        },
      });

    return this.status();
  }

  private async loadState(orgId: string): Promise<{
    completedSteps: string[];
    answers: Record<string, unknown>;
  }> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.bootstrapState)
      .where(and(eq(schema.bootstrapState.orgId, orgId), eq(schema.bootstrapState.appKey, this.appKey)))
      .limit(1);
    const row = rows[0];
    if (!row) return { completedSteps: [], answers: {} };
    return {
      completedSteps: row.completedSteps,
      answers: row.answers,
    };
  }
}
