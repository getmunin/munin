import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  AuditLogger,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import { McpRegistryService } from '../../../mcp/mcp.registry.ts';

export interface ThrellExternalToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deliveryUrl: string;
  signingSecret: string;
}

export interface ThrellToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const SELF_SERVICE_SCOPES = ['*'] as const;

@Injectable()
export class ThrellToolBridge {
  private readonly logger = new Logger(ThrellToolBridge.name);
  private readonly audit = new AuditLogger();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(McpRegistryService) private readonly registry: McpRegistryService,
  ) {}

  buildToolList(opts: {
    deliveryUrl: string;
    signingSecret: string;
  }): ThrellExternalToolSpec[] {
    return this.registry.list('self_service').map((t) => ({
      name: t.meta.name,
      description: t.meta.description,
      inputSchema: sanitizeJsonSchema(t.inputJsonSchema as Record<string, unknown>),
      deliveryUrl: opts.deliveryUrl,
      signingSecret: opts.signingSecret,
    }));
  }

  async dispatch(opts: {
    orgId: string;
    endUserId: string;
    name: string;
    args: unknown;
  }): Promise<ThrellToolCallResult> {
    const { name } = opts;
    const tool = this.registry.get(name);
    if (!tool) return { ok: false, error: `unknown_tool:${name}` };
    if (!tool.meta.audiences.includes('self_service')) {
      return { ok: false, error: `tool_not_available:${name}` };
    }

    const parsed = tool.meta.input.safeParse(opts.args ?? {});
    if (!parsed.success) {
      return { ok: false, error: `invalid_input: ${parsed.error.message}` };
    }

    const actor = new ActorIdentity(
      'end_user_agent',
      `threll-${opts.endUserId}`,
      opts.orgId,
      SELF_SERVICE_SCOPES,
      ['self_service'],
      opts.endUserId,
    );
    const correlationId = randomUUID();
    const outerCtx: RequestContext = { db: this.db, actor, correlationId };

    const startedAt = Date.now();
    return withContext(outerCtx, async () => {
      try {
        const value = await this.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
          const innerCtx: RequestContext = { db: tx, actor, correlationId };
          return withContext(innerCtx, () => Promise.resolve(tool.handler(parsed.data)));
        });
        await this.audit.record({
          tool: name,
          args: parsed.data,
          result: 'ok',
          durationMs: Date.now() - startedAt,
        });
        return { ok: true, result: value };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.audit.record({
          tool: name,
          result: 'error',
          error: message,
          durationMs: Date.now() - startedAt,
        });
        this.logger.warn(`threll tool '${name}' failed: ${message}`);
        return { ok: false, error: message };
      }
    });
  }
}

const JSON_SCHEMA_META_KEYS = new Set(['$schema', '$id', '$ref', '$defs', 'definitions']);

function sanitizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeNode(schema) as Record<string, unknown>;
}

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeNode);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (JSON_SCHEMA_META_KEYS.has(k)) continue;
      out[k] = sanitizeNode(v);
    }
    return out;
  }
  return node;
}
