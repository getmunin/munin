import { randomUUID } from 'node:crypto';
import {
  AuditLogger,
  RequestContextStore,
  buildAdminAgentActor,
  type ActorIdentity,
  type RequestContext,
} from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { openInProcessMcpClient, type InProcessMcpClient } from '@getmunin/mcp-toolkit';
import type { McpToolRegistry, SkillRegistry } from '@getmunin/mcp-toolkit';
import { applyTenancyGUCs } from '../common/tenancy/tenancy.interceptor.js';

export interface OpenAgentMcpClientOptions {
  db: Db;
  orgId: string;
  registry: McpToolRegistry;
  skills?: SkillRegistry;
  audit?: AuditLogger;
}

export interface AgentMcpClient extends InProcessMcpClient {
  readonly actor: ActorIdentity;
  close(): Promise<void>;
}

export function openAgentMcpClient(opts: OpenAgentMcpClientOptions): AgentMcpClient {
  const actor = buildAdminAgentActor(opts.orgId);
  const audit = opts.audit ?? new AuditLogger();

  const inner = openInProcessMcpClient({
    registry: opts.registry,
    skills: opts.skills,
    actor,
    audience: 'admin',
    audit,
  });

  function withTenancy<T>(fn: () => Promise<T>): Promise<T> {
    return opts.db.transaction(async (tx) => {
      await applyTenancyGUCs(tx, actor);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return RequestContextStore.run(ctx, fn);
    });
  }

  return {
    actor,
    listTools: () => withTenancy(() => inner.listTools()),
    callTool: (name, args) => withTenancy(() => inner.callTool(name, args)),
    listResources: () => withTenancy(() => inner.listResources()),
    readResource: (uri) => withTenancy(() => inner.readResource(uri)),
    close: () => Promise.resolve(),
  };
}
