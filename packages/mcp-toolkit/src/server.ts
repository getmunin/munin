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
import { callTool, listResources, listTools, readResource, type DispatchContext } from './dispatch.js';

export interface CreateMcpServerOptions {
  registry: McpToolRegistry;
  audience: Audience;
  actor: ActorIdentity;
  audit: AuditLogger;
  rateLimit?: (toolName: string) => Promise<void> | void;
  serverInfo?: { name: string; version: string };
  skills?: SkillRegistry;
  instructions?: string;
}

export function createMcpServer(opts: CreateMcpServerOptions): Server {
  const info = opts.serverInfo ?? { name: 'munin', version: process.env.MUNIN_VERSION ?? '0.4.0' };
  const dispatch: DispatchContext = {
    registry: opts.registry,
    audience: opts.audience,
    actor: opts.actor,
    audit: opts.audit,
    rateLimit: opts.rateLimit,
    skills: opts.skills,
  };

  const server = new Server(info, {
    capabilities: { tools: {}, ...(opts.skills ? { resources: {} } : {}) },
    instructions: opts.instructions,
  });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: listTools(dispatch),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const out = await callTool(dispatch, req.params.name, req.params.arguments);
    return out as unknown as Awaited<ReturnType<Parameters<typeof server.setRequestHandler>[1]>>;
  });

  if (opts.skills) {
    server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: listResources(dispatch).map((r) => ({
        ...r,
        annotations: { audience: ['assistant'] as const, priority: 0.9 },
      })),
    }));
    server.setRequestHandler(ReadResourceRequestSchema, (req) => ({
      contents: [readResource(dispatch, req.params.uri)],
    }));
  }

  return server;
}
