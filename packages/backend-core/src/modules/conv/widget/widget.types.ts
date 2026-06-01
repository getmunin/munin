import { z } from 'zod';

export const WidgetChannelConfig = z.object({
  provider: z.literal('widget'),
  originAllowlist: z.array(z.string().url()).default([]),
  webhookOnEscalation: z.string().url().optional(),
  identityVerificationSecret: z.string().min(32).max(256).optional(),
  requireVerifiedIdentity: z.boolean().default(false),
  voiceChannelId: z.string().min(1).max(64).optional(),
});

export type WidgetChannelConfigT = z.infer<typeof WidgetChannelConfig>;

export const WIDGET_END_USER_BODY_MAX_CHARS = 1_000;
export const WIDGET_END_USER_BODY_HTML_MAX_CHARS = 4_000;

export const WidgetIngestMessage = z.object({
  role: z.literal('end_user').default('end_user'),
  body: z.string().min(1).max(WIDGET_END_USER_BODY_MAX_CHARS),
  bodyHtml: z.string().max(WIDGET_END_USER_BODY_HTML_MAX_CHARS).optional(),
  providerMessageId: z.string().min(1).max(200).optional(),
  inReplyTo: z.string().min(1).max(200).optional(),
  at: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
});

export const WidgetIngestInput = z.object({
  channelId: z.string().min(1),
  sessionId: z.string().min(1).max(200),
  visitorId: z.string().min(1).max(200).optional(),
  verifiedExternalId: z.string().min(1).max(200).optional(),
  userHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'userHash must be a 64-char hex sha256 digest')
    .optional(),
  visitor: z
    .object({
      name: z.string().max(120).optional(),
      email: z.string().email().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  url: z.string().url().optional(),
  providerThreadId: z.string().max(200).optional(),
  messages: z.array(WidgetIngestMessage).min(1).max(50),
});

export type WidgetIngestInputT = z.infer<typeof WidgetIngestInput>;

export interface WidgetIngestResult {
  conversationId: string;
  displayId: number;
  contactId: string;
  inserted: number;
  skipped: number;
}

export const WidgetVoiceStartInput = z.object({
  channelId: z.string().min(1),
  conversationId: z.string().min(1),
  sessionId: z.string().min(1).max(200),
  verifiedExternalId: z.string().min(1).max(200).optional(),
  userHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'userHash must be a 64-char hex sha256 digest')
    .optional(),
});

export type WidgetVoiceStartInputT = z.infer<typeof WidgetVoiceStartInput>;

export const WidgetVoiceEventInput = z.object({
  channelId: z.string().min(1),
  conversationId: z.string().min(1),
  sessionId: z.string().min(1).max(200),
  verifiedExternalId: z.string().min(1).max(200).optional(),
  userHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'userHash must be a 64-char hex sha256 digest')
    .optional(),
  kind: z.enum(['started', 'ended']),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 12).optional(),
});

export type WidgetVoiceEventInputT = z.infer<typeof WidgetVoiceEventInput>;

export interface WidgetVoiceEventResult {
  ok: true;
}

export type WidgetVoiceStartResult =
  | { available: false; reason: string }
  | {
      available: true;
      descriptor:
        | {
            vendor: 'vapi';
            publicKey: string;
            assistantId: string;
            metadata: { conversationId: string; endUserId: string };
            assistant?: Record<string, unknown>;
            assistantOverrides?: Record<string, unknown>;
          };
    };

export const WidgetListMessagesQuery = z.object({
  channelId: z.string().min(1),
  sessionId: z.string().min(1).max(200),
  since: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  verifiedExternalId: z.string().min(1).max(200).optional(),
  userHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'userHash must be a 64-char hex sha256 digest')
    .optional(),
});

export type WidgetListMessagesQueryT = z.infer<typeof WidgetListMessagesQuery>;

export interface WidgetListedMessage {
  id: string;
  role: 'end_user' | 'agent' | 'system';
  authorKind: 'ai' | 'human' | null;
  authorName: string | null;
  body: string;
  bodyHtml: string | null;
  at: string;
  readAt: string | null;
}

export interface WidgetConversationEnvelope {
  id: string;
  subject: string | null;
  status: string;
  handedOver: boolean;
  assigneeName: string | null;
  contactEmail: string | null;
}

export interface WidgetListMessagesResult {
  messages: WidgetListedMessage[];
  hasMore: boolean;
  conversation: WidgetConversationEnvelope | null;
}

export const WidgetListConversationsQuery = z.object({
  channelId: z.string().min(1),
  sessionIds: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((x) => x.trim())
            .filter((x) => x.length > 0)
            .slice(0, 20)
        : [],
    ),
  verifiedExternalId: z.string().min(1).max(200).optional(),
  userHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'userHash must be a 64-char hex sha256 digest')
    .optional(),
});

export type WidgetListConversationsQueryT = z.infer<typeof WidgetListConversationsQuery>;

export interface WidgetConversationSummary {
  id: string;
  sessionId: string;
  title: string;
  preview: string;
  status: string;
  handedOver: boolean;
  lastMessageAt: string | null;
}

export interface WidgetListConversationsResult {
  conversations: WidgetConversationSummary[];
}

export const WidgetSetVisitorInput = z.object({
  channelId: z.string().min(1),
  sessionId: z.string().min(1).max(200),
  visitorId: z.string().min(1).max(200).optional(),
  email: z.string().email().max(200).optional(),
  name: z.string().min(1).max(120).optional(),
  verifiedExternalId: z.string().min(1).max(200).optional(),
  userHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'userHash must be a 64-char hex sha256 digest')
    .optional(),
});

export type WidgetSetVisitorInputT = z.infer<typeof WidgetSetVisitorInput>;

export interface WidgetSetVisitorResult {
  contactId: string;
  email: string | null;
  name: string | null;
}

export const WidgetStartConversationInput = z.object({
  channelId: z.string().min(1),
  sessionId: z.string().min(1).max(200),
  visitorId: z.string().min(1).max(200).optional(),
  verifiedExternalId: z.string().min(1).max(200).optional(),
  userHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'userHash must be a 64-char hex sha256 digest')
    .optional(),
  visitor: z
    .object({
      name: z.string().max(120).optional(),
      email: z.string().email().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  url: z.string().url().optional(),
});

export type WidgetStartConversationInputT = z.infer<typeof WidgetStartConversationInput>;

export interface WidgetStartConversationResult {
  conversationId: string;
  displayId: number;
  contactId: string;
}
