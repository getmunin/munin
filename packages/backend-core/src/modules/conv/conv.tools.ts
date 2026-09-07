import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { getCurrentContext } from '@getmunin/core';
import { AGENT_MODES, CHANNEL_TYPES, ConvService, HANDOVER_FILTERS, STATUSES } from './conv.service.ts';
import { ConvAutomationService } from './conv-automation.service.ts';
import { IdMapSchema } from '../../common/transfer/transfer.types.ts';

const ChannelTypeSchema = z.enum(CHANNEL_TYPES);
const StatusSchema = z.enum(STATUSES);
const AgentModeSchema = z.enum(AGENT_MODES);
const HandoverSchema = z.enum(HANDOVER_FILTERS);

const ListConversationsInput = z.object({
  status: StatusSchema.optional(),
  assigneeUserId: z.string().optional(),
  topicId: z.string().optional(),
  endUserId: z.string().optional().describe(
    "End-user identity id (from `identity_resolve`); keeps only conversations belonging to that person, across every channel they've used.",
  ),
  handover: HandoverSchema.optional().describe(
    '`active` = waiting on a human right now, `resolved` = a handover was answered and cleared, `never` = no handover on record.',
  ),
  since: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe('ISO 8601 timestamp; keeps only conversations whose last message is at or after it.'),
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

const EmailOpenStatsInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Restrict to one email channel. Omit to cover every email channel in the org.'),
  sinceDays: z
    .number()
    .int()
    .positive()
    .max(365)
    .optional()
    .describe('Window size in days, counted back from now. Defaults to 30.'),
});

const TopicDescriptionSchema = z
  .string()
  .max(600)
  .describe(
    'What belongs in this topic, in the org\'s own words — the boundary against adjacent topics, the vocabulary customers use for it, and anything that looks like it fits but does not. This is what a classifier reads when deciding where a conversation goes; a bare name is not enough to tell "Support" from "Technical".',
  );

const CreateTopicInput = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64),
  description: TopicDescriptionSchema.optional(),
  color: z.string().max(16).optional(),
});

const UpdateTopicInput = z.object({
  topicId: z.string(),
  name: z.string().min(1).max(120).optional(),
  description: TopicDescriptionSchema.nullable()
    .optional()
    .describe(
      'Replaces the topic\'s description. Pass null to clear it. Omit to leave it unchanged. What belongs in this topic, in the org\'s own words — the boundary against adjacent topics, the vocabulary customers use for it, and anything that looks like it fits but does not.',
    ),
  color: z.string().max(16).nullable().optional(),
});

const SetTopicInput = z.object({
  conversationId: z.string(),
  topicId: z.string().nullable(),
});

const SetTopicAutomationInput = z.object({
  topicId: z.string(),
  mode: AgentModeSchema.nullable().describe(
    '`auto` sends replies in this topic without review, `draft_only` parks every reply as a draft for the review queue, `off` stops the agent from replying in the topic, and `null` clears the override so conversations fall back to their own mode.',
  ),
  promoteThresholdPct: z
    .number()
    .int()
    .min(50)
    .max(100)
    .optional()
    .describe(
      'Share of reviewed replies that must have been approved unedited before this topic is reported as ready to promote to `auto`, as a whole percent. Reporting only — reaching it never promotes the topic on its own. Defaults to 90; omit to leave unchanged.',
    ),
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

const ConvImportInput = z.object({
  records: z.object({
    channels: z.array(
      z.object({
        id: z.string(),
        type: ChannelTypeSchema,
        vendor: z.string().min(1).max(32),
        name: z.string().min(1).max(120),
        active: z.boolean(),
      }),
    ),
    conversations: z.array(
      z.object({
        id: z.string(),
        channelId: z.string(),
        subject: z.string().nullable(),
        status: StatusSchema,
        topicSlug: z.string().nullable(),
        agentMode: AgentModeSchema,
      }),
    ),
    messages: z.array(
      z.object({
        id: z.string(),
        conversationId: z.string(),
        authorType: z.enum(['user', 'agent', 'end_user', 'system']),
        authorId: z.string(),
        body: z.string(),
        internal: z.boolean(),
        inReplyToId: z.string().nullable(),
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Injectable()
export class ConvAdminTools {
  constructor(
    @Inject(ConvService) private readonly conv: ConvService,
    @Inject(ConvAutomationService) private readonly automation: ConvAutomationService,
  ) {}

  @McpTool({
    name: 'conv_list_topic_automation',
    title: 'Conv: List topic automation',
    description:
      'List every conversation topic with its automation mode (`auto`, `draft_only`, `off`, or null when it inherits the conversation default) and its recent review record: weekly reply volume, and how many replies in the 30-day window were approved unedited, edited, or rejected by a human, plus the share of all replies auto-sent over the last 7 days. This is the evidence base for deciding whether a topic is ready to promote to auto-send.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listTopicAutomation() {
    return this.automation.listTopicAutomation();
  }

  @McpTool({
    name: 'conv_set_topic_automation',
    title: 'Conv: Set topic automation',
    description:
      'Set the automation mode for one topic. A topic mode overrides the per-conversation mode for every conversation tagged with the topic: `auto` sends replies directly, `draft_only` parks each reply as a draft for human review, `off` stops the agent from replying, and `null` clears the override. Promoting to `auto` stamps when the promotion happened; any other mode clears the stamp. Emits `conversation.topic_automation_changed`.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SetTopicAutomationInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setTopicAutomation(args: z.infer<typeof SetTopicAutomationInput>) {
    return this.automation.setTopicAgentMode(args);
  }

  @McpTool({
    name: 'conv_list_conversations',
    title: 'Conv: List conversations',
    description:
      'List conversations for your org, newest activity first. Filter by status (open / snoozed / closed / spam), assignee, topic, handover state (`active` / `resolved` / `never`), or `since` an ISO timestamp. `handover: "resolved"` plus `since` is the set a knowledge-curation pass works from: questions a human answered inside the window.',
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
      'Flag a conversation as needing human attention. Use this when you have reached the limit of what you can resolve autonomously — billing decisions, refunds outside policy, sensitive complaints, anything where a human teammate should step in. Appends an internal note (visible only to staff) recording your stated `reason`, sets the conversation\'s "needs human attention" flag (which pins it to the top of the dashboard\'s Conversations page), and emits `conversation.handover_requested`. Pass `suggestedReply` ONLY when you have a substantive answer to propose — write it as the reply a teammate could send the end-user to resolve the issue, so they can edit, approve, or rewrite it. Don\'t fill it with a "a teammate will follow up" acknowledgement or a copy of any message already sent to the end-user; if you have no real answer to suggest, OMIT it. A suggested reply is a proposal for the next outbound message: once any public message goes out on the conversation, it is retired and the team is no longer offered it. Idempotent — calling again on an already-flagged conversation is a no-op. The flag clears automatically once a human teammate replies or closes the conversation.',
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
    name: 'conv_get_email_open_stats',
    title: 'Conv: Read email open stats',
    description:
      'Aggregate email open tracking per email channel over a recent window (default 30 days, max 365). Returns for each channel the number of messages delivered in the window, how many of those were opened at least once, the total open count, and the resulting open rate, plus org-wide totals. `trackOpens` reports whether the channel currently embeds the tracking pixel — a channel with tracking off records no opens, so its rate reads 0 rather than "nobody opened these". Open tracking is best-effort in general: only messages with an HTML part carry a pixel, clients that block remote images never report an open, and privacy proxies such as Apple Mail Privacy Protection pre-fetch images and inflate the count.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmailOpenStatsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getEmailOpenStats(args: z.infer<typeof EmailOpenStatsInput>) {
    return this.conv.getEmailOpenStats(args);
  }

  @McpTool({
    name: 'conv_list_channels',
    title: 'Conv: List conversation channels',
    description: 'List conversation channels of every kind configured for your org — email, chat (widget), SMS and voice.',
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
    name: 'conv_list_topics',
    title: 'Conv: List conversation topics',
    description:
      "List conversation topics (Billing, Support, Refunds, …) for your org, each with the description its operators wrote for it. The description states what belongs in the topic and where its boundary against adjacent topics runs; when one is present it is the authority on whether a conversation fits, ahead of the name. A topic with no description has never been defined beyond its label.",
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
    description:
      'Add a new conversation topic. Slug must be lowercase letters, digits, hyphens. The optional description defines what belongs in the topic; supplying one is what lets later conversations be filed here accurately, since name and slug carry the same single word of signal.',
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
    name: 'conv_update_topic',
    title: 'Conv: Update a conversation topic',
    description:
      "Rename a topic, rewrite its description, or change its colour. Omitted fields are left alone. The description is the org's definition of what belongs in the topic and is read whenever a conversation is filed, so keeping it current is how classification boundaries are corrected. The slug is fixed at creation — it is how exports and imports address the topic. Automation mode is set separately with `conv_set_topic_automation`.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: UpdateTopicInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateTopic(args: z.infer<typeof UpdateTopicInput>) {
    return this.conv.updateTopic(args);
  }

  @McpTool({
    name: 'conv_set_topic',
    title: 'Conv: Set or clear a conversation topic',
    description:
      'Tag a conversation with one of the org\'s existing topics, or pass `topicId: null` to clear the topic. Use `conv_list_topics` first to see what topics exist; topics must be pre-created via `conv_create_topic`. A topic can carry an automation override, so tagging may change whether the agent sends replies directly or parks them as drafts; when it does, an internal note recording the change is added to the conversation for the operators reviewing it.',
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
      "Replace an inbound message's body with a signature-stripped version. Used by the strip-email-signature curator skill — runs after the regex quote-stripper to clean up the trailing sign-off / contact block. The original body is kept in `metadata.preStripBody` for audit; the removed signature (if provided) is stored in `metadata.signatureText`. Refuses if the new body is empty or if the message isn't an end-user inbound in the caller's org. A cut that removes more than half the body is allowed only when `signatureText` is supplied, matches the removed trailing portion, and carries multiple contact-info hints (email, phone, address, URL) — this is what lets a one-line reply followed by a large contact block be cleaned. An applied cut emits `conversation.message.body_revised`, which re-syncs the message's mirrored copy in connected operator bridges (Slack) so the signature disappears there too.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: StripMessageSignatureInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  stripMessageSignature(args: z.infer<typeof StripMessageSignatureInput>) {
    return this.conv.stripMessageSignature(args);
  }

  @McpTool({
    name: 'conv_export',
    title: 'Conv: Export data',
    description:
      "Export this org's conversation channels, conversations, and messages as a portable JSON payload. Pair with `conv_import` on another Munin server to move conversations between self-hosted and cloud. Channel credentials are NOT included — they are encrypted with this server's key and must be re-entered on the target. Feed the returned `records` straight into `conv_import`.",
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  exportConv() {
    return this.conv.exportConv();
  }

  @McpTool({
    name: 'conv_import',
    title: 'Conv: Import data',
    description:
      'Import conversation `records` produced by `conv_export` (typically from another Munin server). Channels are upserted by (type, vendor, name) and recreated without credentials — re-enter them on this server. Conversations and messages are append-only with no natural key: fresh ids are generated and parent FKs (channelId, conversationId) are resolved through the `idMap`. Messages with `authorType: "system"` are always stored as internal staff-only notes regardless of the `internal` flag in the payload, and each coercion is reported in `warnings`. Returns counts, `warnings`, and an `idMap` (source id → id on this server); pass that `idMap` back into later imports so dependent records resolve their parents. Re-running within a single migration is idempotent via the idMap, but messages are not deduplicated across separate runs.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ConvImportInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  importConv(args: z.infer<typeof ConvImportInput>) {
    return this.conv.importConv(args.records, args.idMap);
  }
}
