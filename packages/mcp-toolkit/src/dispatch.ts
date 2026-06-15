import {
  getCurrentContext,
  type AuditLogger,
  type ActorIdentity,
  type Audience,
} from '@getmunin/core';
import type { McpToolRegistry } from './registry.ts';
import { redactSensitive } from './sensitive.ts';
import type { RegisteredSkill, SkillRegistry } from './skill-registry.ts';
import { SKILLS_LIST_TOOL, SKILLS_READ_TOOL, SKILL_TOOLS } from './skill-tools.ts';

export interface CaptureExceptionContext {
  tool?: string;
  actor?: { type?: string | null; id?: string | null; orgId?: string | null } | null;
  args?: Record<string, unknown> | null;
}

export type CaptureExceptionFn = (
  error: unknown,
  context?: CaptureExceptionContext,
) => void;

export interface DispatchContext {
  registry: McpToolRegistry;
  audience: Audience;
  actor: ActorIdentity;
  audit: AuditLogger;
  rateLimit?: (toolName: string) => Promise<void> | void;
  skills?: SkillRegistry;
  apiBaseUrl?: string;
  captureException?: CaptureExceptionFn;
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

function skillToolListings(): ToolListing[] {
  return SKILL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.readOnlyHint,
      destructiveHint: t.destructiveHint,
    },
  }));
}

export function listTools(ctx: DispatchContext): ToolListing[] {
  const tools = ctx.registry
    .list(ctx.audience)
    .filter((t) => t.meta.scopes.every((s) => ctx.actor.hasScope(s)))
    .map((t) => ({
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
  if (listResources(ctx).length > 0) {
    tools.push(...skillToolListings());
  }
  return tools;
}

export async function callTool(
  ctx: DispatchContext,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolCallResult> {
  if (name === SKILLS_LIST_TOOL || name === SKILLS_READ_TOOL) {
    return callSkillTool(ctx, name, args);
  }

  const tool = ctx.registry.get(name);
  if (!tool) {
    await ctx.audit.record({ tool: name, result: 'denied', error: 'unknown_tool' });
    return errorResult(`Unknown tool: ${name}`);
  }

  const redactedRawArgs = safeRedact(tool.meta.input, args ?? {});

  if (!tool.meta.audiences.includes(ctx.audience)) {
    await ctx.audit.record({
      tool: tool.meta.name,
      args: redactedRawArgs,
      result: 'denied',
      error: 'audience_mismatch',
    });
    return errorResult(`Tool ${tool.meta.name} is not available for this caller`);
  }

  for (const scope of tool.meta.scopes) {
    if (!ctx.actor.hasScope(scope)) {
      await ctx.audit.record({
        tool: tool.meta.name,
        args: redactedRawArgs,
        result: 'denied',
        error: `missing_scope:${scope}`,
      });
      return errorResult(`Missing required scope: ${scope}`);
    }
  }

  const parseResult = tool.meta.input.safeParse(args ?? {});
  if (!parseResult.success) {
    await ctx.audit.record({
      tool: tool.meta.name,
      args: redactedRawArgs,
      result: 'error',
      error: `invalid_input: ${parseResult.error.message}`,
    });
    return errorResult(`Invalid input: ${parseResult.error.message}`);
  }

  const redactedArgs = safeRedact(tool.meta.input, parseResult.data);

  if (ctx.rateLimit) {
    try {
      await ctx.rateLimit(tool.meta.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.audit.record({
        tool: tool.meta.name,
        args: redactedArgs,
        result: 'denied',
        error: 'rate_limited',
      });
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
      args: redactedArgs,
      result: 'error',
      error: message,
      durationMs: Date.now() - startedAt,
    });
    safeReportException(ctx.captureException, thrown, {
      tool: tool.meta.name,
      actor: { type: ctx.actor.type, id: ctx.actor.id, orgId: ctx.actor.orgId },
      args: redactedArgs,
    });
    return errorResult(message);
  }
  await ctx.audit.record({
    tool: tool.meta.name,
    args: redactedArgs,
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

async function callSkillTool(
  ctx: DispatchContext,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolCallResult> {
  if (!ctx.skills) {
    await ctx.audit.record({ tool: name, result: 'denied', error: 'unknown_tool' });
    return errorResult(`Unknown tool: ${name}`);
  }

  if (name === SKILLS_LIST_TOOL) {
    const payload = listResources(ctx).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
    }));
    await ctx.audit.record({ tool: name, result: 'ok' });
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  }

  const uri = typeof args?.uri === 'string' ? args.uri : undefined;
  if (!uri) {
    await ctx.audit.record({
      tool: name,
      args: { uri: args?.uri ?? null },
      result: 'error',
      error: 'invalid_input: "uri" is required',
    });
    return errorResult('Invalid input: "uri" (string) is required');
  }

  const skill = ctx.skills.get(uri);
  if (!skill || !skill.uri.startsWith('skill://')) {
    await ctx.audit.record({ tool: name, args: { uri }, result: 'denied', error: 'unknown_skill' });
    return errorResult(`Unknown skill: ${uri}`);
  }
  if (!skill.audiences.includes(ctx.audience)) {
    await ctx.audit.record({
      tool: name,
      args: { uri },
      result: 'denied',
      error: 'audience_mismatch',
    });
    return errorResult(`Skill ${uri} is not available for this caller`);
  }
  await ctx.audit.record({ tool: name, args: { uri }, result: 'ok' });
  return { content: [{ type: 'text' as const, text: renderSkill(ctx, skill) }] };
}

function renderSkill(ctx: DispatchContext, skill: RegisteredSkill): string {
  let out = skill.content;
  if (ctx.apiBaseUrl) out = out.split('{{API_URL}}').join(ctx.apiBaseUrl);
  if (ctx.actor.orgId) out = out.split('{{ORG_ID}}').join(ctx.actor.orgId);
  return out;
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
    text: renderSkill(ctx, skill),
  };
}

function errorResult(message: string): ToolCallResult {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

function safeRedact(
  schema: Parameters<typeof redactSensitive>[0],
  value: unknown,
): Record<string, unknown> | undefined {
  try {
    const out = redactSensitive(schema, value);
    return out && typeof out === 'object' && !Array.isArray(out)
      ? (out as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function safeReportException(
  capture: CaptureExceptionFn | undefined,
  error: unknown,
  context: CaptureExceptionContext,
): void {
  if (!capture) return;
  try {
    capture(error, context);
  } catch (reportErr) {
    console.error('[mcp-toolkit] error reporter failed:', reportErr);
  }
}
