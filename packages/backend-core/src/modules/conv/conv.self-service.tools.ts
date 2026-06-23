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
      'Flag the current conversation as needing human attention. Use this when you can\'t answer the end-user\'s question on your own — pricing exceptions, account-specific issues you can\'t verify, anything sensitive. Pass the exact `conversationId` you were given in the system context. Sets a "needs human attention" flag on the conversation (pinning it to the top of the team\'s dashboard) and posts an internal note recording your `reason`. Pass `suggestedReply` ONLY when you actually have a substantive answer to propose — write it as the reply you would send the end-user to resolve their question, so a teammate can review, edit, and send it. It must NOT be the "a teammate will follow up" acknowledgement, and must NOT repeat the message you are sending the end-user this turn. If you are escalating precisely because you don\'t have an answer, OMIT `suggestedReply` entirely — an empty draft is far better than one that just parrots your deferral. After calling this, do not keep generating replies on your own — let the user know a teammate will follow up, then stop. The flag clears once a teammate replies. The end-user does not see the system note or the suggested reply — only the team does.',
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
