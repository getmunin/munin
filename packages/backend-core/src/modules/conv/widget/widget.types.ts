import { z } from 'zod';

export const WidgetChannelConfig = z.object({
  provider: z.literal('widget'),
  displayName: z.string().min(1).max(120),
  /** Hostnames allowed to call the public ingest endpoint with the widget key. */
  originAllowlist: z.array(z.string().url()).default([]),
  /** Optional webhook called when a human/agent reply lands so the external bot can step back. */
  webhookOnEscalation: z.string().url().optional(),
  /**
   * Per-channel HMAC secret for browser-side visitor identity verification.
   * The operator's server signs `externalId` with this secret and embeds the
   * resulting hex digest as `data-user-hash` on the widget script tag; Munin
   * recomputes the HMAC on every request and rejects mismatches. Stored
   * plaintext because we must reproduce the digest server-side; protected by
   * RLS like the rest of the channel config.
   */
  identityVerificationSecret: z.string().min(32).max(256).optional(),
  /**
   * When true, the widget API rejects anonymous (sessionId-only) requests.
   * Every POST/GET/WS-subscribe must carry a verified `(externalId, userHash)`
   * pair. Default false: anonymous chat is allowed.
   */
  requireVerifiedIdentity: z.boolean().default(false),
});

export type WidgetChannelConfigT = z.infer<typeof WidgetChannelConfig>;

export const WidgetIngestMessage = z.object({
  role: z.enum(['end_user', 'agent', 'system']),
  body: z.string().min(1).max(50_000),
  bodyHtml: z.string().max(200_000).optional(),
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
  /**
   * Operator-supplied user ID, paired with `userHash`. When both are set
   * Munin verifies `hmac_sha256(channel.identityVerificationSecret, externalId)`
   * matches `userHash` and binds the resulting contact to this externalId.
   * Either both fields must be present or neither.
   */
  verifiedExternalId: z.string().min(1).max(200).optional(),
  /** Hex SHA-256 HMAC digest paired with `verifiedExternalId`. */
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

/**
 * Query for the WS-reconnect backfill endpoint. Browsers pass `since` as
 * an ISO timestamp; the server returns messages with `createdAt > since`,
 * ordered ascending, capped at 100. Identity attributes mirror
 * `WidgetIngestInput` so the same verification rules apply.
 */
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
  body: string;
  bodyHtml: string | null;
  at: string;
}

export interface WidgetListMessagesResult {
  messages: WidgetListedMessage[];
  hasMore: boolean;
}
