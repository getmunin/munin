import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@munin/mcp-toolkit';
import { getCurrentContext } from '@munin/core';
import { CHANNEL_TYPES, ConvService, STATUSES } from './conv.service.js';

const ChannelTypeSchema = z.enum(CHANNEL_TYPES);
const StatusSchema = z.enum(STATUSES);

const ListConversationsInput = z.object({
  status: StatusSchema.optional(),
  assigneeUserId: z.string().optional(),
  topicId: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const GetConversationInput = z.object({ id: z.string() });

const SendMessageInput = z.object({
  conversationId: z.string(),
  body: z.string().min(1).max(50_000),
  internal: z.boolean().optional(),
  inReplyToId: z.string().optional(),
});

const AssignInput = z.object({
  id: z.string(),
  assigneeUserId: z.string().nullable(),
});

const ChangeStatusInput = z.object({
  id: z.string(),
  status: StatusSchema,
  snoozeUntil: z.string().datetime().optional(),
});

const SearchInput = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().positive().max(100).optional(),
});

const CreateChannelInput = z.object({
  type: ChannelTypeSchema,
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).optional(),
});

const CreateTopicInput = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64),
  color: z.string().max(16).optional(),
});

const EmptyInput = z.object({});

@Injectable()
export class ConvAdminTools {
  constructor(@Inject(ConvService) private readonly conv: ConvService) {}

  @McpTool({
    name: 'conv_list_conversations',
    description:
      'List conversations for your org, newest activity first. Filter by status (open / snoozed / closed / spam), assignee, or topic.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: ListConversationsInput,
  })
  listConversations(args: z.infer<typeof ListConversationsInput>) {
    return this.conv.listConversations(args);
  }

  @McpTool({
    name: 'conv_get_conversation',
    description: 'Read one conversation including every public + internal message.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: GetConversationInput,
  })
  getConversation(args: z.infer<typeof GetConversationInput>) {
    return this.conv.getConversation(args.id);
  }

  @McpTool({
    name: 'conv_send_message',
    description:
      'Append a message to a conversation. Pass `internal: true` to leave a staff-only note (drafts, side comments) — end-user agents never see internal messages.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendMessageInput,
  })
  sendMessage(args: z.infer<typeof SendMessageInput>) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    return this.conv.sendMessage({
      ...args,
      authorType: actor.type === 'user' ? 'user' : 'agent',
      authorId: actor.id,
    });
  }

  @McpTool({
    name: 'conv_assign_conversation',
    description:
      'Assign a conversation to a user (pass user id) or unassign (pass null). Useful for routing escalated tickets.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: AssignInput,
  })
  assign(args: z.infer<typeof AssignInput>) {
    return this.conv.assignConversation(args);
  }

  @McpTool({
    name: 'conv_change_status',
    description:
      'Change a conversation\'s status. `snoozeUntil` (ISO 8601) is required when status is "snoozed".',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ChangeStatusInput,
  })
  changeStatus(args: z.infer<typeof ChangeStatusInput>) {
    return this.conv.changeStatus(args);
  }

  @McpTool({
    name: 'conv_search_messages',
    description:
      'Substring search over message bodies. Returns the matching messages newest first; use conv_get_conversation to load surrounding context.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: SearchInput,
  })
  search(args: z.infer<typeof SearchInput>) {
    return this.conv.searchMessages(args);
  }

  @McpTool({
    name: 'conv_list_channels',
    description: 'List conversation channels (email, voice, chat, sms) configured for your org.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmptyInput,
  })
  listChannels() {
    return this.conv.listChannels();
  }

  @McpTool({
    name: 'conv_create_channel',
    description:
      'Add a new conversation channel. Type is one of email / voice / chat / sms. Channel-specific configuration goes in `config`.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateChannelInput,
  })
  createChannel(args: z.infer<typeof CreateChannelInput>) {
    return this.conv.createChannel(args);
  }

  @McpTool({
    name: 'conv_list_topics',
    description: 'List conversation topics (Billing, Support, Refunds, …) for your org.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmptyInput,
  })
  listTopics() {
    return this.conv.listTopics();
  }

  @McpTool({
    name: 'conv_create_topic',
    description: 'Add a new conversation topic. Slug must be lowercase letters, digits, hyphens.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateTopicInput,
  })
  createTopic(args: z.infer<typeof CreateTopicInput>) {
    return this.conv.createTopic(args);
  }
}
