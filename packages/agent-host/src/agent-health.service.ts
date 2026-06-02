import { Inject, Injectable, Logger } from '@nestjs/common';
import { getCurrentContext } from '@getmunin/core';
import { sql } from 'drizzle-orm';
import type { ProviderErrorCode } from '@getmunin/agent-runtime';
import { AGENT_CONFIG_REPOSITORY, ALERT_RECORDER } from './injection-tokens.ts';
import type { AgentConfigRepository } from './config.repository.ts';
import type { AlertRecorder, AlertRecorderSeverity } from './alert-recorder.ts';

export type AgentHealthStatus = 'ok' | 'degraded';

export interface AgentHealthDto {
  id: string;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

export interface AgentHealthRecorder {
  recordSuccess(id: string): Promise<{ flipped: boolean }>;
  recordFailure(id: string, code: ProviderErrorCode, message: string): Promise<void>;
}

@Injectable()
export class AgentHealthService implements AgentHealthRecorder {
  private readonly log = new Logger('AgentHealthService');

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly configRepo: AgentConfigRepository,
    @Inject(ALERT_RECORDER) private readonly alerts: AlertRecorder,
  ) {}

  async recordSuccess(id: string): Promise<{ flipped: boolean }> {
    await this.ensureRow(id);
    await getCurrentContext().db.execute(sql`
      UPDATE agent_health
      SET last_ok_at = now(), updated_at = now()
      WHERE id = ${id}
    `);
    const { resolved } = await this.alerts.resolveAlert({ source: 'llm_provider', subjectId: id });
    if (resolved) {
      this.log.log(`agent-health ${id} recovered`);
      await this.sweepRetryable(id);
      return { flipped: true };
    }
    return { flipped: false };
  }

  async recordFailure(
    id: string,
    code: ProviderErrorCode,
    message: string,
  ): Promise<void> {
    await this.ensureRow(id);
    await getCurrentContext().db.execute(sql`
      UPDATE agent_health
      SET last_error_at = now(), updated_at = now()
      WHERE id = ${id}
    `);
    await this.alerts.openAlert({
      source: 'llm_provider',
      subjectId: id,
      severity: severityFor(code),
      title: titleFor(code),
      detail: message,
      metadata: { code },
    });
    this.log.warn(`agent-health ${id} degraded (${code})`);
  }

  private async sweepRetryable(id: string): Promise<void> {
    const orgId = await this.configRepo.resolveOrgId(id);
    const result = await getCurrentContext().db.execute<{ id: string }>(sql`
      UPDATE curator_jobs
      SET status = 'pending',
          next_attempt_at = now(),
          updated_at = now()
      WHERE org_id = ${orgId}
        AND status = 'failed_retryable'
        AND last_error_code LIKE 'provider_%'
      RETURNING id
    `);
    const count = Array.isArray(result) ? result.length : 0;
    if (count > 0) {
      this.log.log(`agent-health ${id} sweep re-enqueued ${count} curator job(s)`);
    }
  }

  private async ensureRow(id: string): Promise<void> {
    await getCurrentContext().db.execute(sql`
      INSERT INTO agent_health (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING
    `);
  }
}

function severityFor(code: ProviderErrorCode): AlertRecorderSeverity {
  return code === 'provider_rate_limit' ? 'warning' : 'error';
}

function titleFor(code: ProviderErrorCode): string {
  switch (code) {
    case 'provider_auth':
      return 'AI provider auth failing';
    case 'provider_regional':
      return 'AI provider region not enabled';
    case 'provider_rate_limit':
      return 'AI provider rate limited';
    case 'provider_model_not_found':
      return 'AI provider model not found';
    case 'provider_other':
    default:
      return 'AI provider error';
  }
}
