import { randomUUID } from 'node:crypto';
import {
  AuditLogger,
  RequestContextStore,
  buildAdminAgentActor,
  buildEndUserAgentActor,
  type ActorIdentity,
  type Audience,
  type RequestContext,
} from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { openInProcessMcpClient, type InProcessMcpClient } from '@getmunin/mcp-toolkit';
import type { McpToolRegistry, SkillRegistry } from '@getmunin/mcp-toolkit';
import { applyTenancyGUCs } from '../common/tenancy/tenancy.interceptor.ts';

export interface OpenAdminAgentMcpClientOptions {
  db: Db;
  orgId: string;
  registry: McpToolRegistry;
  skills?: SkillRegistry;
  audit?: AuditLogger;
}

export interface OpenEndUserAgentMcpClientOptions {
  db: Db;
  orgId: string;
  endUserId: string;
  registry: McpToolRegistry;
  skills?: SkillRegistry;
  audit?: AuditLogger;
  scopes?: readonly string[];
  audiences?: readonly Audience[];
}

export interface AgentMcpClient extends InProcessMcpClient {
  readonly actor: ActorIdentity;
  close(): Promise<void>;
}

export function openAdminAgentMcpClient(opts: OpenAdminAgentMcpClientOptions): AgentMcpClient {
  const actor = buildAdminAgentActor(opts.orgId);
  return wrapInProcessMcp({
    db: opts.db,
    actor,
    audience: 'admin',
    registry: opts.registry,
    skills: opts.skills,
    audit: opts.audit,
  });
}

export function openEndUserAgentMcpClient(opts: OpenEndUserAgentMcpClientOptions): AgentMcpClient {
  const actor = buildEndUserAgentActor({
    orgId: opts.orgId,
    endUserId: opts.endUserId,
    scopes: opts.scopes,
    audiences: opts.audiences,
  });
  const audience: Audience = actor.audiences.includes('self_service') ? 'self_service' : 'admin';
  return wrapInProcessMcp({
    db: opts.db,
    actor,
    audience,
    registry: opts.registry,
    skills: opts.skills,
    audit: opts.audit,
  });
}

interface WrapOptions {
  db: Db;
  actor: ActorIdentity;
  audience: Audience;
  registry: McpToolRegistry;
  skills?: SkillRegistry;
  audit?: AuditLogger;
}

function wrapInProcessMcp(opts: WrapOptions): AgentMcpClient {
  const audit = opts.audit ?? new AuditLogger();
  const inner = openInProcessMcpClient({
    registry: opts.registry,
    skills: opts.skills,
    actor: opts.actor,
    audience: opts.audience,
    audit,
  });

  function withTenancy<T>(fn: () => Promise<T>): Promise<T> {
    return opts.db.transaction(async (tx) => {
      await applyTenancyGUCs(tx, opts.actor);
      const ctx: RequestContext = { db: tx, actor: opts.actor, correlationId: randomUUID() };
      return RequestContextStore.run(ctx, fn);
    });
  }

  return {
    actor: opts.actor,
    listTools: () => withTenancy(() => inner.listTools()),
    callTool: (name, args) => withTenancy(() => inner.callTool(name, args)),
    listResources: () => withTenancy(() => inner.listResources()),
    readResource: (uri) => withTenancy(() => inner.readResource(uri)),
    close: () => Promise.resolve(),
  };
}
