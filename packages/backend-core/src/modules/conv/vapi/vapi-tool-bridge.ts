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
import { DB } from '../../../common/db/db.module.js';
import { McpRegistryService } from '../../../mcp/mcp.registry.js';

export interface VapiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface VapiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

export interface VapiToolResult {
  toolCallId: string;
  result?: string;
  error?: string;
}

const SELF_SERVICE_SCOPES = ['*'] as const;

@Injectable()
export class VapiToolBridge {
  private readonly logger = new Logger(VapiToolBridge.name);
  private readonly audit = new AuditLogger();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(McpRegistryService) private readonly registry: McpRegistryService,
  ) {}

  buildToolList(): VapiFunctionTool[] {
    return this.registry.list('self_service').map((t) => ({
      type: 'function',
      function: {
        name: t.meta.name,
        description: t.meta.description,
        parameters: sanitizeJsonSchemaForVapi(t.inputJsonSchema as Record<string, unknown>),
      },
    }));
  }

  async dispatch(opts: {
    orgId: string;
    endUserId: string;
    toolCalls: VapiToolCall[];
  }): Promise<VapiToolResult[]> {
    const results: VapiToolResult[] = [];
    for (const call of opts.toolCalls) {
      const id = call.id ?? randomUUID();
      const name = call.function?.name;
      if (!name) {
        results.push({ toolCallId: id, error: 'tool_call_missing_name' });
        continue;
      }
      const tool = this.registry.get(name);
      if (!tool) {
        results.push({ toolCallId: id, error: `unknown_tool:${name}` });
        continue;
      }
      if (!tool.meta.audiences.includes('self_service')) {
        results.push({ toolCallId: id, error: `tool_not_available:${name}` });
        continue;
      }

      const rawArgs = call.function?.arguments;
      let args: unknown;
      try {
        args = typeof rawArgs === 'string' ? (rawArgs ? JSON.parse(rawArgs) : {}) : (rawArgs ?? {});
      } catch (err) {
        results.push({
          toolCallId: id,
          error: `invalid_arguments_json: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      const parsed = tool.meta.input.safeParse(args);
      if (!parsed.success) {
        results.push({ toolCallId: id, error: `invalid_input: ${parsed.error.message}` });
        continue;
      }

      const actor = new ActorIdentity(
        'end_user_agent',
        `vapi-${opts.endUserId}`,
        opts.orgId,
        SELF_SERVICE_SCOPES,
        ['self_service'],
        opts.endUserId,
      );
      const correlationId = randomUUID();
      const outerCtx: RequestContext = { db: this.db, actor, correlationId };

      const startedAt = Date.now();
      await withContext(outerCtx, async () => {
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
          results.push({
            toolCallId: id,
            result: typeof value === 'string' ? value : JSON.stringify(value),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.audit.record({
            tool: name,
            result: 'error',
            error: message,
            durationMs: Date.now() - startedAt,
          });
          this.logger.warn(`vapi tool '${name}' failed: ${message}`);
          results.push({ toolCallId: id, error: message });
        }
      });
    }
    return results;
  }
}

const JSON_SCHEMA_META_KEYS = new Set(['$schema', '$id', '$ref', '$defs', 'definitions']);

function sanitizeJsonSchemaForVapi(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeNode(schema) as Record<string, unknown>;
}

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeNode);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (JSON_SCHEMA_META_KEYS.has(k)) continue;
      if (k === 'additionalProperties' && isEmptySchema(v)) {
        out[k] = true;
        continue;
      }
      out[k] = sanitizeNode(v);
    }
    return out;
  }
  return node;
}

function isEmptySchema(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.keys(v).length === 0;
}
