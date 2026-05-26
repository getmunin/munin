import { Inject, Injectable, Logger } from '@nestjs/common';
import { getCurrentContext } from '@getmunin/core';
import { sql } from 'drizzle-orm';
import type { ProviderErrorCode } from '@getmunin/agent-runtime';
import { AGENT_CONFIG_REPOSITORY } from './injection-tokens.js';
import type { AgentConfigRepository } from './config.repository.js';

export type AgentHealthStatus = 'ok' | 'degraded';

export interface AgentHealthDto {
  id: string;
  status: AgentHealthStatus;
  lastProviderErrorCode: ProviderErrorCode | null;
  lastProviderErrorMessage: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

export interface AgentHealthRecorder {
  recordSuccess(id: string): Promise<{ flipped: boolean }>;
  recordFailure(id: string, code: ProviderErrorCode, message: string): Promise<void>;
}

interface AgentHealthRow {
  id: string;
  lastProviderErrorCode: string | null;
  lastProviderErrorMessage: string | null;
  lastErrorAt: Date | string | null;
  lastOkAt: Date | string | null;
}

@Injectable()
export class AgentHealthService implements AgentHealthRecorder {
  private readonly log = new Logger('AgentHealthService');

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly configRepo: AgentConfigRepository,
  ) {}

  async getForCurrentActor(): Promise<AgentHealthDto> {
    const id = this.configRepo.resolveCurrentId();
    return this.get(id);
  }

  async get(id: string): Promise<AgentHealthDto> {
    await this.ensureRow(id);
    const row = await this.readRow(id);
    return toDto(row);
  }

  async recordSuccess(id: string): Promise<{ flipped: boolean }> {
    await this.ensureRow(id);
    const before = await this.readRow(id);
    const wasDegraded = isDegraded(before);
    await getCurrentContext().db.execute(sql`
      UPDATE agent_health
      SET last_ok_at = now(), updated_at = now()
      WHERE id = ${id}
    `);
    if (wasDegraded) {
      this.log.log(`agent-health ${id} recovered (was ${before.lastProviderErrorCode ?? 'unknown'})`);
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
    const trimmed = message.length > 1000 ? `${message.slice(0, 1000)}…` : message;
    await getCurrentContext().db.execute(sql`
      UPDATE agent_health
      SET last_provider_error_code = ${code},
          last_provider_error_message = ${trimmed},
          last_error_at = now(),
          updated_at = now()
      WHERE id = ${id}
    `);
    this.log.warn(`agent-health ${id} degraded (${code}): ${trimmed}`);
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

  private async readRow(id: string): Promise<AgentHealthRow> {
    const rows = await getCurrentContext().db.execute<{
      id: string;
      last_provider_error_code: string | null;
      last_provider_error_message: string | null;
      last_error_at: Date | null;
      last_ok_at: Date | null;
    }>(sql`
      SELECT id, last_provider_error_code, last_provider_error_message, last_error_at, last_ok_at
      FROM agent_health
      WHERE id = ${id}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) throw new Error(`agent_health row missing for id='${id}'`);
    return {
      id: row.id,
      lastProviderErrorCode: row.last_provider_error_code,
      lastProviderErrorMessage: row.last_provider_error_message,
      lastErrorAt: row.last_error_at,
      lastOkAt: row.last_ok_at,
    };
  }
}

function isDegraded(row: AgentHealthRow): boolean {
  const errAt = toDate(row.lastErrorAt);
  if (!errAt) return false;
  const okAt = toDate(row.lastOkAt);
  if (!okAt) return true;
  return okAt.getTime() < errAt.getTime();
}

function toDto(row: AgentHealthRow): AgentHealthDto {
  return {
    id: row.id,
    status: isDegraded(row) ? 'degraded' : 'ok',
    lastProviderErrorCode: (row.lastProviderErrorCode as ProviderErrorCode | null) ?? null,
    lastProviderErrorMessage: row.lastProviderErrorMessage,
    lastErrorAt: toIso(row.lastErrorAt),
    lastOkAt: toIso(row.lastOkAt),
  };
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | string | null): string | null {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}
