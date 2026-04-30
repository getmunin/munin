import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { getCurrentContext } from '@getmunin/core';

const PingInput = z.object({
  message: z.string().optional(),
});

/**
 * The "hello world" of Munin MCP tools. Used to smoke-test the full pipe:
 *   client → AuthGuard → TenancyInterceptor → MCP transport → tool dispatch
 *   → audit row → response.
 *
 * Visible to both audiences so admin and self-service flows can both hit
 * something in M0.
 */
@Injectable()
export class PingMcpTool {
  @McpTool({
    name: 'ping',
    title: 'Ping the MCP server',
    description: 'Verify the MCP pipe; echoes a message and returns the resolved org and actor type.',
    audiences: ['admin', 'self_service'],
    scopes: [],
    input: PingInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  ping(args: z.infer<typeof PingInput>) {
    const ctx = getCurrentContext();
    return {
      message: args.message ?? 'pong',
      orgId: ctx.actor?.orgId,
      actorType: ctx.actor?.type,
      correlationId: ctx.correlationId,
      now: new Date().toISOString(),
    };
  }
}
