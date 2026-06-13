import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { ConvService } from './conv.service.ts';

const RequestMyHandoverInput = z.object({
  conversationId: z.string(),
  reason: z.string().max(500).optional(),
  suggestedReply: z.string().max(2000).optional(),
});

@Injectable()
export class ConvSelfServiceTools {
  constructor(@Inject(ConvService) private readonly conv: ConvService) {}

  @McpTool({
    name: 'conv_request_human',
    title: 'Conv: Request a human teammate to take over',
    description:
      'Flag the current conversation as needing human attention. Use this when you can\'t answer the end-user\'s question on your own — pricing exceptions, account-specific issues you can\'t verify, anything sensitive. Pass the exact `conversationId` you were given in the system context. Sets a "needs human attention" flag on the conversation (pinning it to the top of the team\'s dashboard) and posts an internal note recording your `reason`. Also pass `suggestedReply` — your best guess at what a human teammate could send to resolve the issue. The team sees this as a starting draft they can edit, approve, or rewrite. After calling this, do not keep generating replies on your own — let the user know a teammate will follow up, then stop. The flag clears once a teammate replies. The end-user does not see the system note or the suggested reply — only the team does.',
    audiences: ['self_service'],
    scopes: ['conv:write'],
    input: RequestMyHandoverInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestMyHandover(args: z.infer<typeof RequestMyHandoverInput>) {
    return this.conv.requestHandover({ ...args, postSystemNote: false });
  }
}
