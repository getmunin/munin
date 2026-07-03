import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { getCurrentContext } from '@getmunin/core';
import { INSPECTOR_HELLO_URI } from './inspector.resource.ts';

const InspectorHelloInput = z.object({});

@Injectable()
export class InspectorMcpTool {
  @McpTool({
    name: 'inspector_hello',
    title: 'Inspector: Hello Munin',
    description:
      'Returns a small greeting payload rendered by the Hello Munin MCP App panel. A plumbing spike for interactive MCP Apps panels.',
    audiences: ['admin'],
    scopes: [],
    input: InspectorHelloInput,
    readOnlyHint: true,
    destructiveHint: false,
    _meta: { ui: { resourceUri: INSPECTOR_HELLO_URI }, 'ui/resourceUri': INSPECTOR_HELLO_URI },
  })
  hello() {
    const ctx = getCurrentContext();
    return {
      greeting: 'Hello from Munin 👋',
      orgId: ctx.actor?.orgId,
      actorType: ctx.actor?.type,
      now: new Date().toISOString(),
    };
  }
}
