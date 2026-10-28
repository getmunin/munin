import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { ActorIdentity, getCurrentContext, withContext } from '@getmunin/core';
import { normalizeIdentityEmail } from '../analytics/visitor-identity.ts';
import { DB } from '../../common/db/db.module.ts';
import { applyTenancyGUCs } from '../../common/tenancy/tenancy.interceptor.ts';
import { ProductEventsService } from '../analytics/product-events.service.ts';
import { isTrustedEmailSource, type EndUserProvenanceMetadata } from '../connectors/identity-provenance.ts';
import type { BookingSummary } from './booking-adapter.ts';

export const BOOKING_EVENTS_ACTOR_ID = 'bookings';
export const BOOKING_EVENT_NAMES = ['booking.created', 'booking.updated', 'booking.cancelled'] as const;
export type BookingEventName = (typeof BOOKING_EVENT_NAMES)[number];

export interface BookingEventInput {
  name: BookingEventName;
  email: string;
  connectionId: string;
  vendor: string;
  bookingRef: string;
  booking: BookingSummary | null;
}

type EventRecorder = Pick<ProductEventsService, 'record'>;

@Injectable()
export class BookingEventsService {
  private readonly logger = new Logger(BookingEventsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ProductEventsService) private readonly productEvents: EventRecorder,
  ) {}

  async record(input: BookingEventInput): Promise<void> {
    const caller = getCurrentContext().actor!;
    const actor = new ActorIdentity('system', BOOKING_EVENTS_ACTOR_ID, caller.orgId, ['*'], ['admin']);
    const booking = input.booking;
    try {
      await this.db.transaction(async (tx) => {
        await applyTenancyGUCs(tx, actor);
        await withContext({ db: tx, actor, correlationId: randomUUID() }, async () => {
          const verified = await this.verifiedFor(caller, input.email);
          await this.productEvents.record([
            {
              id: `booking:${randomUUID()}`,
              name: input.name,
              identity: { email: input.email, ...(verified ? {} : { verified: false }) },
              properties: {
                source: 'munin',
                vendor: input.vendor,
                connectionId: input.connectionId,
                bookingRef: input.bookingRef,
                via: caller.hasAudience('self_service') ? 'self_service' : 'admin',
                confirmationCode: booking?.confirmationCode ?? null,
                status: booking?.status ?? null,
                venue: booking?.venue ?? null,
                startsAt: booking?.startsAt ?? null,
                durationMinutes: booking?.durationMinutes ?? null,
                partySize: booking?.partySize ?? null,
              },
            },
          ]);
        });
      });
    } catch (err) {
      this.logger.warn(
        `${input.name} for booking ${input.bookingRef} was not recorded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async verifiedFor(caller: ActorIdentity, email: string): Promise<boolean> {
    if (!caller.hasAudience('self_service')) return true;
    if (!caller.endUserId) return false;
    const ctx = getCurrentContext();
    const [endUser] = await ctx.db
      .select({ email: schema.endUsers.email, metadata: schema.endUsers.metadata })
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.orgId, caller.orgId), eq(schema.endUsers.id, caller.endUserId)))
      .limit(1);
    if (!endUser?.email) return false;
    const source = (endUser.metadata as EndUserProvenanceMetadata | null)?.emailSource;
    return isTrustedEmailSource(source) && normalizeIdentityEmail(endUser.email) === normalizeIdentityEmail(email);
  }
}
