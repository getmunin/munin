import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import { personalizeEmail } from './email-template-render.ts';
import { broadcastUnsubscribeUrl } from './outreach-broadcasts.service.ts';

const MESSAGE_RECEIVED = 'conversation.message.received';
const SEED_AUTHOR_ID = 'outreach-broadcast';

@Injectable()
export class OutreachBroadcastReplySink implements EventSink {
  async onEvent(event: EmittedEvent): Promise<void> {
    if (event.type !== MESSAGE_RECEIVED) return;
    if (event.payload.authorType !== 'end_user') return;
    if (event.payload.autoReply === true) return;
    const conversationId =
      typeof event.payload.conversationId === 'string' ? event.payload.conversationId : null;
    if (!conversationId) return;

    const ctx = getCurrentContext();
    const r = schema.outreachBroadcastRecipients;
    const [recipient] = await ctx.db
      .select({
        id: r.id,
        orgId: r.orgId,
        broadcastId: r.broadcastId,
        contactId: r.contactId,
        sentAt: r.sentAt,
      })
      .from(r)
      .where(and(eq(r.conversationId, conversationId), isNull(r.repliedAt)))
      .limit(1);
    if (!recipient) return;

    const b = schema.outreachBroadcasts;
    const [broadcast] = await ctx.db
      .select({
        subject: b.subject,
        preheader: b.preheader,
        approvedHtml: b.approvedHtml,
        decidedByActorType: b.decidedByActorType,
        decidedByActorId: b.decidedByActorId,
        orgName: schema.orgs.name,
      })
      .from(b)
      .innerJoin(schema.orgs, eq(schema.orgs.id, b.orgId))
      .where(eq(b.id, recipient.broadcastId))
      .limit(1);
    if (!broadcast?.approvedHtml) return;

    const [contact] = recipient.contactId
      ? await ctx.db
          .select({ name: schema.crmContacts.name })
          .from(schema.crmContacts)
          .where(eq(schema.crmContacts.id, recipient.contactId))
          .limit(1)
      : [];
    const { text } = personalizeEmail(broadcast.approvedHtml, {
      name: contact?.name ?? null,
      orgName: broadcast.orgName,
      subject: broadcast.subject,
      preheader: broadcast.preheader,
      unsubscribeUrl: recipient.contactId
        ? broadcastUnsubscribeUrl(recipient.orgId, recipient.contactId, recipient.broadcastId)
        : null,
    });
    const byPerson = broadcast.decidedByActorType === 'user' && broadcast.decidedByActorId;
    const now = new Date();
    await ctx.db.insert(schema.convMessages).values({
      orgId: recipient.orgId,
      conversationId,
      authorType: byPerson ? 'user' : 'agent',
      authorId: byPerson ? broadcast.decidedByActorId! : SEED_AUTHOR_ID,
      body: text,
      internal: false,
      metadata: {
        outreachBroadcastId: recipient.broadcastId,
        outreachBroadcastRecipientId: recipient.id,
      },
      createdAt: recipient.sentAt ?? new Date(now.getTime() - 1000),
    });
    await ctx.db
      .update(r)
      .set({ repliedAt: now, updatedAt: now })
      .where(eq(r.id, recipient.id));
  }
}
