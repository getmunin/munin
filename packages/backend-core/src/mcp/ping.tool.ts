import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { getCurrentContext } from '@getmunin/core';

const PingInput = z.object({
  message: z.string().optional(),
});

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
