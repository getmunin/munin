import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AuditLogger, ActorIdentity, Audience } from '@getmunin/core';
import type { McpToolRegistry } from './registry.js';
import type { SkillRegistry } from './skill-registry.js';

export interface CreateMcpServerOptions {
  registry: McpToolRegistry;
  audience: Audience;
  actor: ActorIdentity;
  audit: AuditLogger;
  /**
   * Called once per tools/call before dispatch. If it throws, the call is
   * denied with the thrown error's message and an audit row is written
   * with `result: 'denied'`. tools/list is intentionally not gated so
   * agents can still discover capabilities while rate-limited.
   */
  rateLimit?: (toolName: string) => Promise<void> | void;
  serverInfo?: { name: string; version: string };
  skills?: SkillRegistry;
  instructions?: string;
}

/**
 * Build an MCP `Server` instance configured for one request / one actor.
 *
 * Lifecycle: create per request (Streamable HTTP, stateless mode), wire to
 * a transport, let the transport drive it, dispose. This way each call
 * sees only the tools the actor is allowed to use, and audit attribution
 * is correct.
 */
export function createMcpServer(opts: CreateMcpServerOptions): Server {
  const { registry, audience, actor, audit, rateLimit, skills, instructions } = opts;
  const info = opts.serverInfo ?? { name: 'munin', version: process.env.MUNIN_VERSION ?? '0.4.0' };

  const server = new Server(info, {
    capabilities: { tools: {}, ...(skills ? { resources: {} } : {}) },
    instructions,
  });

  // tools/list — visible-to-this-audience subset.
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registry.list(audience).map((t) => ({
      name: t.meta.name,
      description: t.meta.description,
      inputSchema: t.inputJsonSchema as Record<string, unknown>,
      annotations: {
        title: t.meta.title ?? t.meta.name,
        readOnlyHint: t.meta.readOnlyHint ?? false,
        destructiveHint: t.meta.destructiveHint ?? false,
      },
    })),
  }));

  // tools/call — audience + scope check, validate input, dispatch, audit.
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = registry.get(req.params.name);
    if (!tool) {
      await audit.record({ tool: req.params.name, result: 'denied', error: 'unknown_tool' });
      return errorResult(`Unknown tool: ${req.params.name}`);
    }

    if (!tool.meta.audiences.includes(audience)) {
      await audit.record({ tool: tool.meta.name, result: 'denied', error: 'audience_mismatch' });
      return errorResult(`Tool ${tool.meta.name} is not available for this caller`);
    }

    for (const scope of tool.meta.scopes) {
      if (!actor.hasScope(scope)) {
        await audit.record({ tool: tool.meta.name, result: 'denied', error: `missing_scope:${scope}` });
        return errorResult(`Missing required scope: ${scope}`);
      }
    }

    const parseResult = tool.meta.input.safeParse(req.params.arguments ?? {});
    if (!parseResult.success) {
      await audit.record({ tool: tool.meta.name, result: 'error', error: 'invalid_input' });
      return errorResult(`Invalid input: ${parseResult.error.message}`);
    }

    if (rateLimit) {
      try {
        await rateLimit(tool.meta.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await audit.record({ tool: tool.meta.name, result: 'denied', error: 'rate_limited' });
        return errorResult(message);
      }
    }

    const startedAt = Date.now();
    try {
      const value = await tool.handler(parseResult.data);
      await audit.record({
        tool: tool.meta.name,
        args: parseResult.data,
        result: 'ok',
        durationMs: Date.now() - startedAt,
      });
      return {
        content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await audit.record({
        tool: tool.meta.name,
        result: 'error',
        error: message,
        durationMs: Date.now() - startedAt,
      });
      return errorResult(message);
    }
  });

  if (skills) {
    server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: skills.list(audience).map((s) => ({
        uri: s.uri,
        name: s.name,
        description: s.description,
        mimeType: s.mimeType,
        annotations: { audience: ['assistant'] as const, priority: 0.9 },
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, (req) => {
      const skill = skills.get(req.params.uri);
      if (!skill) {
        throw new Error(`Unknown resource: ${req.params.uri}`);
      }
      if (!skill.audiences.includes(audience)) {
        throw new Error(`Resource ${skill.uri} is not available for this caller`);
      }
      return {
        contents: [
          {
            uri: skill.uri,
            mimeType: skill.mimeType,
            text: skill.content,
          },
        ],
      };
    });
  }

  return server;
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}
