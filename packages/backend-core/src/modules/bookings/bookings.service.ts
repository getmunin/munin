import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeEmail } from '../connectors/connector.ts';
import {
  ConnectorsService,
  connectionSummary,
  type ConnectionSummary,
} from '../connectors/connectors.service.ts';
import type {
  BookingAdapter,
  BookingAvailabilitySlot,
  BookingDetail,
  BookingSummary,
  BookingUpdateInput,
} from './booking-adapter.ts';

@Injectable()
export class BookingsService {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  private async bookingScope(connectionId?: string) {
    const scope = await this.connectors.resolveScope('bookings', connectionId);
    const adapter = scope.adapter as BookingAdapter;
    return { scope, adapter, ctx: this.connectors.connectionContext(scope.connection) };
  }

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

  async checkAvailability(args: {
    date: string;
    partySize: number;
    seatingTime?: number;
    connectionId?: string;
  }): Promise<{ connection: ConnectionSummary; slots: BookingAvailabilitySlot[] }> {
    const { scope, adapter, ctx } = await this.bookingScope(args.connectionId);
    if (!adapter.checkAvailability) {
      throw new BadRequestException(
        'bookings_invalid: this connection does not support availability lookups',
      );
    }
    const slots = await this.connectors.vendorCall(() =>
      adapter.checkAvailability!(ctx, {
        date: args.date,
        partySize: args.partySize,
        seatingTime: args.seatingTime,
      }),
    );
    return { connection: connectionSummary(scope.connection), slots };
  }

  async createBooking(args: {
    email: string;
    date: string;
    time: string;
    partySize: number;
    seatingTime?: number;
    areaId?: number;
    name?: string;
    phone?: string;
    note?: string;
    connectionId?: string;
  }): Promise<{ connection: ConnectionSummary; bookingRef: string; booking: BookingDetail | null }> {
    const { scope, adapter, ctx } = await this.bookingScope(args.connectionId);
    if (!adapter.createBooking) {
      throw new BadRequestException(
        'bookings_invalid: this connection does not support creating bookings',
      );
    }
    const email = normalizeEmail(args.email);
    const { bookingRef } = await this.connectors.vendorCall(() =>
      adapter.createBooking!(ctx, {
        email,
        date: args.date,
        time: args.time,
        partySize: args.partySize,
        seatingTime: args.seatingTime,
        areaId: args.areaId,
        name: args.name,
        phone: args.phone,
        note: args.note,
      }),
    );
    const booking = adapter.getBookingForGuest
      ? await this.connectors.vendorCall(() =>
          adapter.getBookingForGuest(ctx, { email, bookingRef }),
        )
      : null;
    return { connection: connectionSummary(scope.connection), bookingRef, booking };
  }

  async updateBooking(args: {
    bookingRef: string;
    connectionId?: string;
    email?: string;
  } & BookingUpdateInput): Promise<{ connection: ConnectionSummary; updated: true; bookingRef: string }> {
    const { scope, adapter, ctx } = await this.bookingScope(args.connectionId);
    if (!adapter.updateBooking) {
      throw new BadRequestException(
        'bookings_invalid: this connection does not support updating bookings',
      );
    }
    if (args.email) await this.assertOwned(adapter, ctx, args.email, args.bookingRef);
    await this.connectors.vendorCall(() =>
      adapter.updateBooking!(ctx, {
        bookingRef: args.bookingRef,
        date: args.date,
        time: args.time,
        partySize: args.partySize,
        note: args.note,
      }),
    );
    return { connection: connectionSummary(scope.connection), updated: true, bookingRef: args.bookingRef };
  }

  async cancelBooking(args: {
    bookingRef: string;
    connectionId?: string;
    email?: string;
  }): Promise<{ connection: ConnectionSummary; cancelled: true; bookingRef: string }> {
    const { scope, adapter, ctx } = await this.bookingScope(args.connectionId);
    if (!adapter.cancelBooking) {
      throw new BadRequestException(
        'bookings_invalid: this connection does not support cancelling bookings',
      );
    }
    if (args.email) await this.assertOwned(adapter, ctx, args.email, args.bookingRef);
    await this.connectors.vendorCall(() =>
      adapter.cancelBooking!(ctx, { bookingRef: args.bookingRef }),
    );
    return { connection: connectionSummary(scope.connection), cancelled: true, bookingRef: args.bookingRef };
  }

  async createMyBooking(args: {
    date: string;
    time: string;
    partySize: number;
    seatingTime?: number;
    areaId?: number;
    name?: string;
    phone?: string;
    note?: string;
    connectionId?: string;
  }): Promise<{ connection: ConnectionSummary; bookingRef: string; booking: BookingDetail | null }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.createBooking({ ...args, email });
  }

  async updateMyBooking(
    args: { bookingRef: string; connectionId?: string } & BookingUpdateInput,
  ): Promise<{ connection: ConnectionSummary; updated: true; bookingRef: string }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.updateBooking({ ...args, email });
  }

  async cancelMyBooking(args: {
    bookingRef: string;
    connectionId?: string;
  }): Promise<{ connection: ConnectionSummary; cancelled: true; bookingRef: string }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.cancelBooking({ ...args, email });
  }

  private async assertOwned(
    adapter: BookingAdapter,
    ctx: ReturnType<ConnectorsService['connectionContext']>,
    email: string,
    bookingRef: string,
  ): Promise<void> {
    const booking = await this.connectors.vendorCall(() =>
      adapter.getBookingForGuest(ctx, { email: normalizeEmail(email), bookingRef }),
    );
    if (!booking) {
      throw new NotFoundException('bookings_not_found: no such booking for that guest');
    }
  }
}
