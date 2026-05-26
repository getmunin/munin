import { Controller, Get, Inject, Query, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { UnsubscribeTokenError, verifyUnsubscribeToken } from '@getmunin/core';
import { AllowAnonymous } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';

interface UnsubscribeResult {
  ok: boolean;
  alreadyUnsubscribed: boolean;
  contactFound: boolean;
}

@Controller('v1/outreach/unsubscribe')
export class OutreachUnsubscribeController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @AllowAnonymous()
  async unsubscribe(@Query('token') token?: string): Promise<UnsubscribeResult> {
    if (!token) throw new BadRequestException('token required');
    let payload;
    try {
      payload = verifyUnsubscribeToken(token);
    } catch (err) {
      if (err instanceof UnsubscribeTokenError) throw new BadRequestException(err.message);
      throw err;
    }
    const rows = await this.db
      .select({
        id: schema.crmContacts.id,
        unsubscribedAt: schema.crmContacts.unsubscribedAt,
        doNotContact: schema.crmContacts.doNotContact,
      })
      .from(schema.crmContacts)
      .where(
        and(
          eq(schema.crmContacts.id, payload.contactId),
          eq(schema.crmContacts.orgId, payload.orgId),
        ),
      )
      .limit(1);
    const contact = rows[0];
    if (!contact) {
      return { ok: true, alreadyUnsubscribed: false, contactFound: false };
    }
    const alreadyUnsubscribed = contact.unsubscribedAt !== null && contact.doNotContact;
    if (alreadyUnsubscribed) {
      return { ok: true, alreadyUnsubscribed: true, contactFound: true };
    }
    const now = new Date();
    await this.db
      .update(schema.crmContacts)
      .set({ unsubscribedAt: now, doNotContact: true, updatedAt: now })
      .where(
        and(
          eq(schema.crmContacts.id, payload.contactId),
          eq(schema.crmContacts.orgId, payload.orgId),
        ),
      );
    await this.db.insert(schema.crmActivities).values({
      orgId: payload.orgId,
      type: 'note',
      subject: 'Unsubscribed',
      body: `Unsubscribed via outreach link for campaign ${payload.campaignId}`,
      contactId: payload.contactId,
      actorType: 'agent',
      actorId: 'outreach-unsubscribe',
      metadata: { unsubscribe: { campaignId: payload.campaignId, issuedAt: payload.issuedAt } },
    });
    return { ok: true, alreadyUnsubscribed: false, contactFound: true };
  }
}
