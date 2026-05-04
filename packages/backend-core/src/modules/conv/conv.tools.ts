import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { getCurrentContext } from '@getmunin/core';
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

const RequestHandoverInput = z.object({
  conversationId: z.string(),
  reason: z.string().max(500).optional(),
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

const SetTopicInput = z.object({
  conversationId: z.string(),
  topicId: z.string().nullable(),
});

const EmptyInput = z.object({});

@Injectable()
export class ConvAdminTools {
  constructor(@Inject(ConvService) private readonly conv: ConvService) {}

  @McpTool({
    name: 'conv_list_conversations',
    title: 'List conversations',
    description:
      'List conversations for your org, newest activity first. Filter by status (open / snoozed / closed / spam), assignee, or topic.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: ListConversationsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listConversations(args: z.infer<typeof ListConversationsInput>) {
    return this.conv.listConversations(args);
  }

  @McpTool({
    name: 'conv_get_conversation',
    title: 'Read conversation',
    description: 'Read one conversation including every public + internal message.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: GetConversationInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getConversation(args: z.infer<typeof GetConversationInput>) {
    return this.conv.getConversation(args.id);
  }

  @McpTool({
    name: 'conv_send_message',
    title: 'Send message in conversation',
    description:
      'Append a message to a conversation. Pass `internal: true` to leave a staff-only note (drafts, side comments) — end-user agents never see internal messages.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendMessageInput,
    readOnlyHint: false,
    destructiveHint: false,
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
    title: 'Assign conversation',
    description:
      'Assign a conversation to a user (pass user id) or unassign (pass null). Useful for routing escalated conversations.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: AssignInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  assign(args: z.infer<typeof AssignInput>) {
    return this.conv.assignConversation(args);
  }

  @McpTool({
    name: 'conv_change_status',
    title: 'Change conversation status',
    description:
      'Change a conversation\'s status. `snoozeUntil` (ISO 8601) is required when status is "snoozed".',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ChangeStatusInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  changeStatus(args: z.infer<typeof ChangeStatusInput>) {
    return this.conv.changeStatus(args);
  }

  @McpTool({
    name: 'conv_request_handover',
    title: 'Request handover to a human',
    description:
      'Flag a conversation as needing human attention. Use this when you have reached the limit of what you can resolve autonomously — billing decisions, refunds outside policy, sensitive complaints, anything where a human teammate should step in. Appends an internal system note (visible only to staff) recording your stated `reason`, sets the conversation\'s "needs human attention" flag (which pins it to the top of the dashboard\'s Conversations page), and emits `conversation.handover_requested`. Idempotent — calling again on an already-flagged conversation is a no-op. The flag clears automatically once a human teammate replies or closes the conversation.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RequestHandoverInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  requestHandover(args: z.infer<typeof RequestHandoverInput>) {
    return this.conv.requestHandover(args);
  }

  @McpTool({
    name: 'conv_search_messages',
    title: 'Search conversation messages',
    description:
      'Substring search over message bodies. Returns the matching messages newest first; use conv_get_conversation to load surrounding context.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: SearchInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  search(args: z.infer<typeof SearchInput>) {
    return this.conv.searchMessages(args);
  }

  @McpTool({
    name: 'conv_list_channels',
    title: 'List conversation channels',
    description: 'List conversation channels configured for your org. Currently shipping adapters: email and chat (widget). The `voice` and `sms` channel types are reserved for upcoming adapters.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listChannels() {
    return this.conv.listChannels();
  }

  @McpTool({
    name: 'conv_create_channel',
    title: 'Create conversation channel',
    description:
      'Add a new conversation channel. Currently shipping adapters: `email` and `chat` (widget). Channel-specific configuration goes in `config`. The `voice` and `sms` channel types are reserved and not yet wired to an adapter.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateChannelInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createChannel(args: z.infer<typeof CreateChannelInput>) {
    return this.conv.createChannel(args);
  }

  @McpTool({
    name: 'conv_list_topics',
    title: 'List conversation topics',
    description: 'List conversation topics (Billing, Support, Refunds, …) for your org.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listTopics() {
    return this.conv.listTopics();
  }

  @McpTool({
    name: 'conv_create_topic',
    title: 'Create conversation topic',
    description: 'Add a new conversation topic. Slug must be lowercase letters, digits, hyphens.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateTopicInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createTopic(args: z.infer<typeof CreateTopicInput>) {
    return this.conv.createTopic(args);
  }

  @McpTool({
    name: 'conv_set_topic',
    title: 'Set or clear a conversation topic',
    description:
      'Tag a conversation with one of the org\'s existing topics, or pass `topicId: null` to clear the topic. Use `conv_list_topics` first to see what topics exist; topics must be pre-created via `conv_create_topic`.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SetTopicInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  setTopic(args: z.infer<typeof SetTopicInput>) {
    return this.conv.setTopic(args);
  }
}
