import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import {
  UnsubscribeTokenError,
  verifyUnsubscribeToken,
  type UnsubscribeTokenPayload,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';

const BROADCAST_ID_PREFIX = 'obc_';

export type UnsubscribeState = 'invalid' | 'not_found' | 'subscribed' | 'unsubscribed';

export type UnsubscribeMethod = 'one_click' | 'page';

export interface UnsubscribeView {
  state: UnsubscribeState;
  orgName: string | null;
}

export interface UnsubscribeResult extends UnsubscribeView {
  alreadyUnsubscribed: boolean;
}

interface ContactRow {
  unsubscribedAt: Date | null;
  doNotContact: boolean;
}

@Injectable()
export class OutreachUnsubscribeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async inspect(token: string | undefined): Promise<UnsubscribeView> {
    const payload = verify(token);
    if (!payload) return { state: 'invalid', orgName: null };
    const [orgName, contact] = await Promise.all([
      this.orgName(payload.orgId),
      this.contact(payload),
    ]);
    if (!contact) return { state: 'not_found', orgName };
    return { state: isUnsubscribed(contact) ? 'unsubscribed' : 'subscribed', orgName };
  }

  async unsubscribe(
    token: string | undefined,
    method: UnsubscribeMethod,
  ): Promise<UnsubscribeResult> {
    const payload = verify(token);
    if (!payload) return { state: 'invalid', orgName: null, alreadyUnsubscribed: false };
    const [orgName, contact] = await Promise.all([
      this.orgName(payload.orgId),
      this.contact(payload),
    ]);
    if (!contact) return { state: 'not_found', orgName, alreadyUnsubscribed: false };
    if (isUnsubscribed(contact)) {
      return { state: 'unsubscribed', orgName, alreadyUnsubscribed: true };
    }

    const now = new Date();
    await this.db
      .update(schema.crmContacts)
      .set({ unsubscribedAt: contact.unsubscribedAt ?? now, doNotContact: true, updatedAt: now })
      .where(
        and(
          eq(schema.crmContacts.id, payload.contactId),
          eq(schema.crmContacts.orgId, payload.orgId),
        ),
      );
    const fromBroadcast = payload.campaignId.startsWith(BROADCAST_ID_PREFIX);
    if (fromBroadcast) {
      await this.db
        .update(schema.outreachBroadcastRecipients)
        .set({ unsubscribedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.outreachBroadcastRecipients.orgId, payload.orgId),
            eq(schema.outreachBroadcastRecipients.broadcastId, payload.campaignId),
            eq(schema.outreachBroadcastRecipients.contactId, payload.contactId),
          ),
        );
    }
    await this.db.insert(schema.crmActivities).values({
      orgId: payload.orgId,
      type: 'note',
      subject: 'Unsubscribed',
      body: `Unsubscribed via outreach link for ${fromBroadcast ? 'broadcast' : 'campaign'} ${payload.campaignId}`,
      contactId: payload.contactId,
      actorType: 'agent',
      actorId: 'outreach-unsubscribe',
      metadata: {
        unsubscribe: { campaignId: payload.campaignId, issuedAt: payload.issuedAt, method },
      },
    });
    return { state: 'unsubscribed', orgName, alreadyUnsubscribed: false };
  }

  private async contact(payload: UnsubscribeTokenPayload): Promise<ContactRow | null> {
    const rows = await this.db
      .select({
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
    return rows[0] ?? null;
  }

  private async orgName(orgId: string): Promise<string | null> {
    const rows = await this.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId))
      .limit(1);
    return rows[0]?.name ?? null;
  }
}

function verify(token: string | undefined): UnsubscribeTokenPayload | null {
  if (!token) return null;
  try {
    return verifyUnsubscribeToken(token);
  } catch (err) {
    if (err instanceof UnsubscribeTokenError) return null;
    throw err;
  }
}

function isUnsubscribed(contact: ContactRow): boolean {
  return contact.unsubscribedAt !== null && contact.doNotContact;
}
