import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { SenderClassification } from './classify-sender.ts';
import {
  extractPlusAddressedConvId,
  parseMessageIdHeader,
} from './mime.ts';

export interface ParsedInboundEmail {
  recipients: string[];
  fromAddress: string;
  fromName: string | null;
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  bodyText: string;
  bodyHtml: string | null;
  senderClassification: SenderClassification;
  authenticationResults: string[];
  arcAuthenticationResults: string[];
}

export interface ThreadResolution {
  conversationId: string;
  via: 'plus-address' | 'in-reply-to';
}

export async function resolveInbound(
  db: Db | Tx,
  orgId: string,
  parsed: ParsedInboundEmail,
  replyDomain: string | null,
): Promise<ThreadResolution | null> {
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

  return null;
}

export { extractPlusAddressedConvId, parseMessageIdHeader };
