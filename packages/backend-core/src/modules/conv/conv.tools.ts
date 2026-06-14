import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { getCurrentContext } from '@getmunin/core';
import { CHANNEL_TYPES, ConvService, STATUSES } from './conv.service.ts';

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
  suggestedReply: z.string().max(2000).optional(),
  publicFallbackMessage: z.string().max(2000).optional(),
});

const SearchInput = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().positive().max(100).optional(),
});

const CreateChannelInput = z.object({
  type: ChannelTypeSchema,
  vendor: z.string().min(1).max(32),
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

const SetSubjectInput = z.object({
  conversationId: z.string(),
  subject: z.string().min(1).max(200).nullable(),
});

const StripMessageSignatureInput = z.object({
  messageId: z.string(),
  body: z.string().min(1).max(50_000),
  signatureText: z.string().max(5_000).optional(),
});

const EmptyInput = z.object({});

@Injectable()
export class ConvAdminTools {
  constructor(@Inject(ConvService) private readonly conv: ConvService) {}

  @McpTool({
    name: 'conv_list_conversations',
    title: 'Conv: List conversations',
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
    title: 'Conv: Read conversation',
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
    title: 'Conv: Send message in conversation',
    description:
      'Append a message to a conversation. Pass `internal: true` to leave a staff-only note (drafts, side comments) — end-user agents never see internal messages.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendMessageInput,
    readOnlyHint: false,
    destructiveHint: true,
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
    title: 'Conv: Assign conversation',
    description:
      'Assign a conversation to a user (pass user id) or unassign (pass null). Useful for routing escalated conversations.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: AssignInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  assign(args: z.infer<typeof AssignInput>) {
    return this.conv.assignConversation(args);
  }

  @McpTool({
    name: 'conv_change_status',
    title: 'Conv: Change conversation status',
    description:
      'Change a conversation\'s status. `snoozeUntil` (ISO 8601) is required when status is "snoozed".',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ChangeStatusInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  changeStatus(args: z.infer<typeof ChangeStatusInput>) {
    return this.conv.changeStatus(args);
  }

  @McpTool({
    name: 'conv_request_handover',
    title: 'Conv: Request handover to a human',
    description:
      'Flag a conversation as needing human attention. Use this when you have reached the limit of what you can resolve autonomously — billing decisions, refunds outside policy, sensitive complaints, anything where a human teammate should step in. Appends an internal system note (visible only to staff) recording your stated `reason`, sets the conversation\'s "needs human attention" flag (which pins it to the top of the dashboard\'s Conversations page), and emits `conversation.handover_requested`. Also pass `suggestedReply` — your best guess at what a human teammate could send to resolve the issue. The team sees this as a starting draft they can edit, approve, or rewrite. Idempotent — calling again on an already-flagged conversation is a no-op. The flag clears automatically once a human teammate replies or closes the conversation.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RequestHandoverInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestHandover(args: z.infer<typeof RequestHandoverInput>) {
    return this.conv.requestHandover(args);
  }

  @McpTool({
    name: 'conv_search_messages',
    title: 'Conv: Search conversation messages',
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
    title: 'Conv: List conversation channels',
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
    title: 'Conv: Create conversation channel',
    description:
      'Add a new conversation channel. Currently shipping adapters: `email` and `chat` (widget). Channel-specific configuration goes in `config`. The `voice` and `sms` channel types are reserved and not yet wired to an adapter.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateChannelInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createChannel(args: z.infer<typeof CreateChannelInput>) {
    return this.conv.createChannel(args);
  }

  @McpTool({
    name: 'conv_list_topics',
    title: 'Conv: List conversation topics',
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
    title: 'Conv: Create conversation topic',
    description: 'Add a new conversation topic. Slug must be lowercase letters, digits, hyphens.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateTopicInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createTopic(args: z.infer<typeof CreateTopicInput>) {
    return this.conv.createTopic(args);
  }

  @McpTool({
    name: 'conv_set_topic',
    title: 'Conv: Set or clear a conversation topic',
    description:
      'Tag a conversation with one of the org\'s existing topics, or pass `topicId: null` to clear the topic. Use `conv_list_topics` first to see what topics exist; topics must be pre-created via `conv_create_topic`.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SetTopicInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setTopic(args: z.infer<typeof SetTopicInput>) {
    return this.conv.setTopic(args);
  }

  @McpTool({
    name: 'conv_set_subject',
    title: 'Conv: Set or clear a conversation subject',
    description:
      "Set a conversation's subject — the short human-readable title shown in the inbox and the chat widget — or pass `subject: null` to clear it. Used by the set-topic-and-title curator skill to title conversations that arrive without a subject (chat, SMS, voice). Email conversations already carry the email Subject line; don't overwrite it.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SetSubjectInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setSubject(args: z.infer<typeof SetSubjectInput>) {
    return this.conv.setSubject(args);
  }

  @McpTool({
    name: 'conv_strip_message_signature',
    title: 'Conv: Strip the signature from an inbound message',
    description:
      "Replace an inbound message's body with a signature-stripped version. Used by the strip-email-signature curator skill — runs after the regex quote-stripper to clean up the trailing sign-off / contact block. The original body is kept in `metadata.preStripBody` for audit; the removed signature (if provided) is stored in `metadata.signatureText`. Refuses if the new body is empty, more than 50% shorter than the original, or if the message isn't an end-user inbound in the caller's org.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: StripMessageSignatureInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  stripMessageSignature(args: z.infer<typeof StripMessageSignatureInput>) {
    return this.conv.stripMessageSignature(args);
  }
}
