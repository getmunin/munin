import { Server, type ServerOptions } from '@modelcontextprotocol/server';
import type { AuditLogger, ActorIdentity, Audience } from '@getmunin/core';
import type { McpToolRegistry } from './registry.ts';
import type { SkillRegistry } from './skill-registry.ts';
import {
  callTool,
  listAppResources,
  listResources,
  listTools,
  readResource,
  type CaptureExceptionFn,
  type DispatchContext,
} from './dispatch.ts';

export interface CreateMcpServerOptions {
  registry: McpToolRegistry;
  audience: Audience;
  actor: ActorIdentity;
  audit: AuditLogger;
  rateLimit?: (toolName: string) => Promise<void> | void;
  serverInfo?: { name: string; version: string };
  skills?: SkillRegistry;
  apiBaseUrl?: string;
  instructions?: string;
  captureException?: CaptureExceptionFn;
}

const CACHE_HINTS: ServerOptions['cacheHints'] = {
  'tools/list': { ttlMs: 60_000, cacheScope: 'private' },
  'resources/list': { ttlMs: 60_000, cacheScope: 'private' },
  'resources/read': { ttlMs: 300_000, cacheScope: 'private' },
  'server/discover': { ttlMs: 300_000, cacheScope: 'private' },
};

export function createMcpServer(opts: CreateMcpServerOptions): Server {
  const info = opts.serverInfo ?? { name: 'munin', version: process.env.MUNIN_VERSION ?? '0.4.0' };
  const dispatch: DispatchContext = {
    registry: opts.registry,
    audience: opts.audience,
    actor: opts.actor,
    audit: opts.audit,
    rateLimit: opts.rateLimit,
    skills: opts.skills,
    apiBaseUrl: opts.apiBaseUrl,
    captureException: opts.captureException,
  };

  const server = new Server(info, {
    capabilities: { tools: {}, ...(opts.skills ? { resources: {} } : {}) },
    instructions: opts.instructions,
    cacheHints: CACHE_HINTS,
  });

  server.setRequestHandler('tools/list', () => ({
    tools: listTools(dispatch),
  }));

  server.setRequestHandler('tools/call', (req) =>
    callTool(dispatch, req.params.name, req.params.arguments),
  );

  if (opts.skills) {
    server.setRequestHandler('resources/list', () => ({
      resources: [
        ...listResources(dispatch).map((r) => ({
          ...r,
          annotations: { audience: ['assistant'] as const, priority: 0.9 },
        })),
        ...listAppResources(dispatch),
      ],
    }));
    server.setRequestHandler('resources/read', (req) => ({
      contents: [readResource(dispatch, req.params.uri)],
    }));
  }

  return server;
}
