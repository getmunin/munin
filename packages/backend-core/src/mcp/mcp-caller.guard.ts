import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ResolvedCredential } from '@getmunin/core';

export const MCP_WIDGET_KEY_REJECTED_CODE = 'mcp_widget_key_rejected';

@Injectable()
export class McpCallerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { credential?: ResolvedCredential }>();
    if (req.credential?.actor.type === 'widget_agent') {
      throw new ForbiddenException(
        `${MCP_WIDGET_KEY_REJECTED_CODE}: a chat-widget key (mn_widget_*) only authorizes /v1/widget/* calls; MCP needs an admin key, an OAuth grant or a delegated end-user token`,
      );
    }
    return true;
  }
}
