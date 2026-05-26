import { schema } from '@getmunin/db';
import { getCurrentContext } from './context.ts';

export interface AuditEventInput {
  tool?: string;
  method?: string;
  target?: { type: string; id: string };
  args?: Record<string, unknown>;
  result?: 'ok' | 'error' | 'denied';
  error?: string;
  durationMs?: number;
  userAgent?: string;
}

/**
 * Records every mutation and tool call. Reads org/actor/correlation
 * from the current request context.
 */
export class AuditLogger {
  /**
   * Insert an audit row. Failures are logged but do not throw — auditing
   * must never break the user's request. (Consider this a soft requirement;
   * if audit is failing repeatedly, we'd want the operator to know.)
   */
  async record(input: AuditEventInput): Promise<void> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor?.orgId || (input.target?.type === 'org' ? input.target.id : null);
    if (!orgId) return;
    try {
      await ctx.db.insert(schema.auditLog).values({
        orgId,
        actorType: ctx.actor?.type ?? 'system',
        actorId: ctx.actor?.id ?? null,
        tool: input.tool ?? null,
        method: input.method ?? null,
        target: input.target ?? null,
        args: input.args ?? null,
        correlationId: ctx.correlationId,
        result: input.result ?? 'ok',
        error: input.error ?? null,
        durationMs: input.durationMs ?? null,
        userAgent: input.userAgent ?? null,
      });
    } catch (err) {
      console.error('[audit] failed to record:', err);
    }
  }
}
