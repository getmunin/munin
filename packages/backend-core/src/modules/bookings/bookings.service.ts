import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeEmail } from '../connectors/connector.ts';
import {
  ConnectorsService,
  connectionSummary,
  type ConnectionSummary,
} from '../connectors/connectors.service.ts';
import type {
  BookingAdapter,
  BookingDetail,
  BookingSummary,
} from './booking-adapter.ts';

@Injectable()
export class BookingsService {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  async lookupBookings(args: {
    email: string;
    connectionId?: string;
    limit: number;
  }): Promise<{ connection: ConnectionSummary; bookings: BookingSummary[] }> {
    const scope = await this.connectors.resolveScope('bookings', args.connectionId);
    const adapter = scope.adapter as BookingAdapter;
    const bookings = await this.connectors.vendorCall(() =>
      adapter.listBookingsForGuest(this.connectors.connectionContext(scope.connection), {
        email: normalizeEmail(args.email),
        limit: args.limit,
      }),
    );
    return { connection: connectionSummary(scope.connection), bookings };
  }

  async lookupBooking(args: {
    email: string;
    connectionId?: string;
    bookingRef?: string;
    confirmationCode?: string;
  }): Promise<{ connection: ConnectionSummary; booking: BookingDetail }> {
    if (!args.bookingRef && !args.confirmationCode) {
      throw new BadRequestException('bookings_invalid: provide bookingRef or confirmationCode');
    }
    const scope = await this.connectors.resolveScope('bookings', args.connectionId);
    const adapter = scope.adapter as BookingAdapter;
    const booking = await this.connectors.vendorCall(() =>
      adapter.getBookingForGuest(this.connectors.connectionContext(scope.connection), {
        email: normalizeEmail(args.email),
        bookingRef: args.bookingRef,
        confirmationCode: args.confirmationCode,
      }),
    );
    if (!booking) {
      throw new NotFoundException('bookings_not_found: no such booking for that guest');
    }
    return { connection: connectionSummary(scope.connection), booking };
  }

  async getMyBookings(args: {
    connectionId?: string;
    limit: number;
  }): Promise<{ connection: ConnectionSummary; bookings: BookingSummary[] }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.lookupBookings({ email, connectionId: args.connectionId, limit: args.limit });
  }

  async getMyBooking(args: {
    connectionId?: string;
    bookingRef?: string;
    confirmationCode?: string;
  }): Promise<{ connection: ConnectionSummary; booking: BookingDetail }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.lookupBooking({ email, ...args });
  }
}
