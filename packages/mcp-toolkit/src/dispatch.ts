import {
  getCurrentContext,
  type AuditLogger,
  type ActorIdentity,
  type Audience,
} from '@getmunin/core';
import type { McpToolRegistry } from './registry.ts';
import { redactSensitive } from './sensitive.ts';
import type { RegisteredSkill, SkillRegistry } from './skill-registry.ts';

export interface DispatchContext {
  registry: McpToolRegistry;
  audience: Audience;
  actor: ActorIdentity;
  audit: AuditLogger;
  rateLimit?: (toolName: string) => Promise<void> | void;
  skills?: SkillRegistry;
}

export interface ToolListing {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
  };
  _meta?: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ResourceListing {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export function listTools(ctx: DispatchContext): ToolListing[] {
  return ctx.registry.list(ctx.audience).map((t) => ({
    name: t.meta.name,
    description: t.meta.description,
    inputSchema: t.inputJsonSchema as Record<string, unknown>,
    annotations: {
      title: t.meta.title ?? t.meta.name,
      readOnlyHint: t.meta.readOnlyHint ?? false,
      destructiveHint: t.meta.destructiveHint ?? false,
    },
    ...(t.meta._meta ? { _meta: t.meta._meta } : {}),
  }));
}

export async function callTool(
  ctx: DispatchContext,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolCallResult> {
  const tool = ctx.registry.get(name);
  if (!tool) {
    await ctx.audit.record({ tool: name, result: 'denied', error: 'unknown_tool' });
    return errorResult(`Unknown tool: ${name}`);
  }

  if (!tool.meta.audiences.includes(ctx.audience)) {
    await ctx.audit.record({ tool: tool.meta.name, result: 'denied', error: 'audience_mismatch' });
    return errorResult(`Tool ${tool.meta.name} is not available for this caller`);
  }

  for (const scope of tool.meta.scopes) {
    if (!ctx.actor.hasScope(scope)) {
      await ctx.audit.record({ tool: tool.meta.name, result: 'denied', error: `missing_scope:${scope}` });
      return errorResult(`Missing required scope: ${scope}`);
    }
  }

  const parseResult = tool.meta.input.safeParse(args ?? {});
  if (!parseResult.success) {
    await ctx.audit.record({ tool: tool.meta.name, result: 'error', error: 'invalid_input' });
    return errorResult(`Invalid input: ${parseResult.error.message}`);
  }

  if (ctx.rateLimit) {
    try {
      await ctx.rateLimit(tool.meta.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.audit.record({ tool: tool.meta.name, result: 'denied', error: 'rate_limited' });
      return errorResult(message);
    }
  }

  const startedAt = Date.now();
  let value: unknown;
  let thrown: unknown = null;
  try {
    const reqCtx = getCurrentContext();
    value = await reqCtx.db.transaction(() => Promise.resolve(tool.handler(parseResult.data)));
  } catch (err) {
    thrown = err;
  }
  if (thrown !== null) {
    const message =
      thrown instanceof Error
        ? thrown.message
        : typeof thrown === 'string'
          ? thrown
          : JSON.stringify(thrown);
    await ctx.audit.record({
      tool: tool.meta.name,
      result: 'error',
      error: message,
      durationMs: Date.now() - startedAt,
    });
    return errorResult(message);
  }
  await ctx.audit.record({
    tool: tool.meta.name,
    args: redactSensitive(tool.meta.input, parseResult.data) as Record<string, unknown>,
    result: 'ok',
    durationMs: Date.now() - startedAt,
  });
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value),
      },
    ],
  };
}

export function listResources(ctx: DispatchContext): ResourceListing[] {
  if (!ctx.skills) return [];
  return ctx.skills
    .list(ctx.audience)
    .filter((s) => s.uri.startsWith('skill://'))
    .map((s) => ({
      uri: s.uri,
      name: s.name,
      description: s.description,
      mimeType: s.mimeType,
    }));
}

export function readResource(ctx: DispatchContext, uri: string): ResourceContent {
  if (!ctx.skills) throw new Error(`Unknown resource: ${uri}`);
  const skill: RegisteredSkill | undefined = ctx.skills.get(uri);
  if (!skill) throw new Error(`Unknown resource: ${uri}`);
  if (!skill.audiences.includes(ctx.audience)) {
    throw new Error(`Resource ${skill.uri} is not available for this caller`);
  }
  return {
    uri: skill.uri,
    mimeType: skill.mimeType,
    text: skill.content,
  };
}

function errorResult(message: string): ToolCallResult {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}
