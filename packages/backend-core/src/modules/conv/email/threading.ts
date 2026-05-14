import { schema, type Db, type Tx } from '@getmunin/db';
import { and, desc, eq, gte, ilike, inArray } from 'drizzle-orm';
import type { SenderClassification } from './classify-sender.js';
import {
  extractPlusAddressedConvId,
  normalizeSubject,
  parseMessageIdHeader,
} from './mime.js';

export interface ParsedInboundEmail {
  /** All recipient addresses from To/Cc/Delivered-To, in raw form. */
  recipients: string[];
  /** Sender email address (extracted, lowercase). */
  fromAddress: string;
  /** Sender display name (when present). */
  fromName: string | null;
  subject: string;
  /** RFC 5322 Message-ID of the inbound message (no `<>`). */
  messageId: string | null;
  /** In-Reply-To header (no `<>`). */
  inReplyTo: string | null;
  /** References list (no `<>`). */
  references: string[];
  /** Plain-text body (already preferring text over stripped HTML). */
  bodyText: string;
  /** HTML body, when the message had one. */
  bodyHtml: string | null;
  /** Sender type classification from RFC headers + From local-part. */
  senderClassification: SenderClassification;
  /** Raw `Authentication-Results` header lines (one per header, value only — key prefix stripped). */
  authenticationResults: string[];
  /** Raw `ARC-Authentication-Results` header lines (one per header, value only). */
  arcAuthenticationResults: string[];
}

export interface ThreadResolution {
  conversationId: string;
  /** How we matched: useful for telemetry / debugging. */
  via: 'plus-address' | 'in-reply-to' | 'subject-fallback';
}

/**
 * Resolve an inbound email to an existing `conv_conversations.id` for the
 * given org. Returns null when no match — caller creates a new conversation.
 *
 * Match order (first hit wins):
 *   1. Plus-address routing on any recipient (`+conv-{id}@<reply-domain>`)
 *   2. In-Reply-To / References → match a `conv_message_deliveries` row's
 *      `message_id_header` for this org
 *   3. Subject-fallback: same sender + same normalized subject + open status
 *      + activity within 30 days
 *
 * Service-role DB (the worker is outside the request context); all WHEREs
 * include org_id explicitly so cross-org leakage is impossible.
 */
export async function resolveInbound(
  db: Db | Tx,
  orgId: string,
  parsed: ParsedInboundEmail,
  replyDomain: string | null,
): Promise<ThreadResolution | null> {
  // 1. Plus-address routing — only meaningful when MUNIN_EMAIL_REPLY_DOMAIN is set.
  if (replyDomain) {
    const convId = extractPlusAddressedConvId(parsed.recipients, replyDomain);
    if (convId) {
      const rows = await db
        .select({ id: schema.convConversations.id })
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.id, convId),
            eq(schema.convConversations.orgId, orgId),
          ),
        )
        .limit(1);
      if (rows[0]) return { conversationId: rows[0].id, via: 'plus-address' };
    }
  }

  // 2. In-Reply-To / References → look up our outbound Message-ID.
  const candidateIds: string[] = [];
  if (parsed.inReplyTo) candidateIds.push(parsed.inReplyTo);
  for (const r of parsed.references) candidateIds.push(r);
  if (candidateIds.length > 0) {
    const rows = await db
      .select({ conversationId: schema.convMessages.conversationId })
      .from(schema.convMessageDeliveries)
      .innerJoin(
        schema.convMessages,
        eq(schema.convMessages.id, schema.convMessageDeliveries.messageId),
      )
      .where(
        and(
          eq(schema.convMessageDeliveries.orgId, orgId),
          inArray(schema.convMessageDeliveries.messageIdHeader, candidateIds),
        ),
      )
      .limit(1);
    if (rows[0]) return { conversationId: rows[0].conversationId, via: 'in-reply-to' };
  }

  // 3. Subject-fallback. Match a contact-by-email + open conversation +
  // similar subject within the last 30 days.
  const normSubject = normalizeSubject(parsed.subject ?? '').slice(0, 200);
  if (normSubject.length > 0) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: schema.convConversations.id,
      })
      .from(schema.convConversations)
      .innerJoin(
        schema.convContacts,
        eq(schema.convContacts.id, schema.convConversations.contactId),
      )
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.status, 'open'),
          eq(schema.convContacts.email, parsed.fromAddress),
          ilike(schema.convConversations.subject, `%${normSubject}%`),
          gte(schema.convConversations.lastMessageAt, cutoff),
        ),
      )
      .orderBy(desc(schema.convConversations.lastMessageAt))
      .limit(1);
    if (rows[0]) return { conversationId: rows[0].id, via: 'subject-fallback' };
  }

  return null;
}

// Re-export the small helpers callers need to talk shape-of-inbound:
export { extractPlusAddressedConvId, normalizeSubject, parseMessageIdHeader };
