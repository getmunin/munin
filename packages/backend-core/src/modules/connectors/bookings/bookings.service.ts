import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeEmail } from '../connector.ts';
import {
  ConnectorsService,
  connectionSummary,
  type ConnectionSummary,
} from '../connectors.service.ts';
import type {
  BookingAdapter,
  BookingReservationDetail,
  BookingReservationSummary,
} from './booking-adapter.ts';

@Injectable()
export class BookingsService {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  async lookupReservations(args: {
    email: string;
    connectionId?: string;
    limit: number;
  }): Promise<{ connection: ConnectionSummary; reservations: BookingReservationSummary[] }> {
    const scope = await this.connectors.resolveScope('bookings', args.connectionId);
    const adapter = scope.adapter as BookingAdapter;
    const reservations = await this.connectors.vendorCall(() =>
      adapter.listReservationsForGuest(this.connectors.connectionContext(scope.connection), {
        email: normalizeEmail(args.email),
        limit: args.limit,
      }),
    );
    return { connection: connectionSummary(scope.connection), reservations };
  }

  async lookupReservation(args: {
    email: string;
    connectionId?: string;
    reservationRef?: string;
    confirmationCode?: string;
  }): Promise<{ connection: ConnectionSummary; reservation: BookingReservationDetail }> {
    if (!args.reservationRef && !args.confirmationCode) {
      throw new BadRequestException('bookings_invalid: provide reservationRef or confirmationCode');
    }
    const scope = await this.connectors.resolveScope('bookings', args.connectionId);
    const adapter = scope.adapter as BookingAdapter;
    const reservation = await this.connectors.vendorCall(() =>
      adapter.getReservationForGuest(this.connectors.connectionContext(scope.connection), {
        email: normalizeEmail(args.email),
        reservationRef: args.reservationRef,
        confirmationCode: args.confirmationCode,
      }),
    );
    if (!reservation) {
      throw new NotFoundException('bookings_not_found: no such reservation for that guest');
    }
    return { connection: connectionSummary(scope.connection), reservation };
  }

  async getMyReservations(args: {
    connectionId?: string;
    limit: number;
  }): Promise<{ connection: ConnectionSummary; reservations: BookingReservationSummary[] }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.lookupReservations({ email, connectionId: args.connectionId, limit: args.limit });
  }

  async getMyReservation(args: {
    connectionId?: string;
    reservationRef?: string;
    confirmationCode?: string;
  }): Promise<{ connection: ConnectionSummary; reservation: BookingReservationDetail }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.lookupReservation({ email, ...args });
  }
}
