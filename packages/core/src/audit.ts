import { schema } from '@munin/db';
import { getCurrentContext } from './context.js';

export interface AuditEventInput {
  /** Tool or method name, e.g. "kb_search" or "POST /api/delegated-token". */
  tool?: string;
  method?: string;
  target?: { type: string; id: string };
  args?: Record<string, unknown>;
  result?: 'ok' | 'error' | 'denied';
  error?: string;
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
    // Partner cross-org operations have no single org_id; skipping these here
    // keeps audit_log clean. Partners can grow a dedicated partner_audit_log
    // when there's demand for tracking provisioning activity over time.
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
      });
    } catch (err) {
      console.error('[audit] failed to record:', err);
    }
  }
}
