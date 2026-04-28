import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@munin/mcp-toolkit';
import { getCurrentContext } from '@munin/core';
import { DeskInvalidError, DeskService } from './desk.service.js';

const StartConversationInput = z.object({
  body: z.string().min(1).max(50_000),
  subject: z.string().max(300).optional(),
  channelHint: z.enum(['email', 'voice', 'chat', 'sms']).optional(),
});

const ListMyInput = z.object({
  status: z.enum(['open', 'snoozed', 'closed', 'spam']).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const GetMyInput = z.object({ id: z.string() });

const SendMyMessageInput = z.object({
  conversationId: z.string(),
  body: z.string().min(1).max(50_000),
});

@Injectable()
export class DeskSelfServiceTools {
  constructor(@Inject(DeskService) private readonly desk: DeskService) {}

  @McpTool({
    name: 'desk_start_conversation',
    description:
      'Start a new helpdesk conversation as the end-user. The platform picks the best channel for you based on `channelHint` (defaults to "chat"). Returns the new conversation with the first message attached.',
    audiences: ['self_service'],
    scopes: ['desk:write'],
    input: StartConversationInput,
  })
  async startConversation(args: z.infer<typeof StartConversationInput>) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!actor.endUserId) {
      throw new DeskInvalidError('end-user identity required to start a conversation');
    }
    const channel =
      (await this.desk.firstActiveChannel(args.channelHint ?? 'chat')) ??
      (await this.desk.firstActiveChannel());
    if (!channel) {
      throw new DeskInvalidError(
        'no active channel configured for this org; ask an admin to create one (e.g. desk_create_channel type=chat)',
      );
    }
    return this.desk.createConversation({
      channelId: channel.id,
      body: args.body,
      subject: args.subject,
      endUserId: actor.endUserId,
      authorType: 'end_user',
      authorId: actor.endUserId,
    });
  }

  @McpTool({
    name: 'desk_list_my_conversations',
    description:
      'List the calling end-user\'s helpdesk conversations. RLS enforces that only the caller\'s own conversations are returned, regardless of filters.',
    audiences: ['self_service'],
    scopes: ['desk:read'],
    input: ListMyInput,
  })
  async listMy(args: z.infer<typeof ListMyInput>) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    return this.desk.listConversations({
      status: args.status,
      endUserId: actor.endUserId,
      limit: args.limit,
    });
  }

  @McpTool({
    name: 'desk_get_my_conversation',
    description:
      'Read one of the calling end-user\'s conversations. RLS hides internal staff messages — only public messages are returned.',
    audiences: ['self_service'],
    scopes: ['desk:read'],
    input: GetMyInput,
  })
  getMy(args: z.infer<typeof GetMyInput>) {
    return this.desk.getConversation(args.id);
  }

  @McpTool({
    name: 'desk_send_message_in_my_conversation',
    description:
      'Append a public message to one of the calling end-user\'s conversations. End-users cannot post internal notes.',
    audiences: ['self_service'],
    scopes: ['desk:write'],
    input: SendMyMessageInput,
  })
  sendMyMessage(args: z.infer<typeof SendMyMessageInput>) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    return this.desk.sendMessage({
      conversationId: args.conversationId,
      body: args.body,
      internal: false,
      authorType: 'end_user',
      authorId: actor.endUserId ?? actor.id,
    });
  }
}
