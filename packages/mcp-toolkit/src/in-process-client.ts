import type { AuditLogger, ActorIdentity, Audience } from '@getmunin/core';
import type { McpToolRegistry } from './registry.ts';
import type { SkillRegistry } from './skill-registry.ts';
import {
  callTool as dispatchCall,
  listResources as dispatchListResources,
  listTools as dispatchListTools,
  readResource as dispatchReadResource,
  type DispatchContext,
  type ResourceContent,
  type ResourceListing,
  type ToolCallResult,
  type ToolListing,
} from './dispatch.ts';

export interface OpenInProcessMcpClientOptions {
  registry: McpToolRegistry;
  actor: ActorIdentity;
  audience: Audience;
  audit: AuditLogger;
  rateLimit?: (toolName: string) => Promise<void> | void;
  skills?: SkillRegistry;
}

export interface InProcessMcpClient {
  listTools(): Promise<ToolListing[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  listResources(): Promise<ResourceListing[]>;
  readResource(uri: string): Promise<ResourceContent>;
}

export function openInProcessMcpClient(opts: OpenInProcessMcpClientOptions): InProcessMcpClient {
  const ctx: DispatchContext = {
    registry: opts.registry,
    audience: opts.audience,
    actor: opts.actor,
    audit: opts.audit,
    rateLimit: opts.rateLimit,
    skills: opts.skills,
  };
  return {
    listTools: () => Promise.resolve(dispatchListTools(ctx)),
    callTool: (name, args) => dispatchCall(ctx, name, args),
    listResources: () => Promise.resolve(dispatchListResources(ctx)),
    readResource: (uri) => Promise.resolve(dispatchReadResource(ctx, uri)),
  };
}
