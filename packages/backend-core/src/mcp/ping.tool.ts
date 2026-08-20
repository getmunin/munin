import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { getCurrentContext } from '@getmunin/core';
import { schema } from '@getmunin/db';

const PingInput = z.object({
  message: z.string().optional(),
});

@Injectable()
export class PingMcpTool {
  @McpTool({
    name: 'ping',
    title: 'Ping the MCP server',
    description:
      'Verify the MCP pipe; echoes a message and returns the resolved org id, org name and actor type.',
    audiences: ['admin', 'self_service'],
    scopes: [],
    input: PingInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async ping(args: z.infer<typeof PingInput>) {
    const ctx = getCurrentContext();
    const orgId = ctx.actor?.orgId;
    let orgName: string | null = null;
    if (orgId) {
      const [org] = await ctx.db
        .select({ name: schema.orgs.name })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, orgId))
        .limit(1);
      orgName = org?.name?.trim() || null;
    }
    return {
      message: args.message ?? 'pong',
      orgId,
      orgName,
      actorType: ctx.actor?.type,
      correlationId: ctx.correlationId,
      now: new Date().toISOString(),
    };
  }
}
