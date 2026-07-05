import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { BookingsService } from './bookings.service.ts';

const LookupReservationsInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const LookupReservationInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  reservationRef: z.string().min(1).max(64).optional(),
  confirmationCode: z.string().min(1).max(64).optional(),
});

@Injectable()
export class BookingAdminTools {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  @McpTool({
    name: 'bookings_lookup_reservations',
    title: 'Bookings: Look up a guest’s reservations',
    description:
      'List a guest’s reservations by email (most recent first), e.g. while handling their support conversation. `connectionId` is only needed when multiple booking connections are active.',
    audiences: ['admin'],
    scopes: ['bookings:read'],
    input: LookupReservationsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupReservations(args: z.infer<typeof LookupReservationsInput>) {
    return this.bookings.lookupReservations(args);
  }

  @McpTool({
    name: 'bookings_lookup_reservation',
    title: 'Bookings: Look up one reservation',
    description:
      'Fetch one reservation for a guest email, including party size, time, venue, and note. Identify it by `reservationRef` (from a listing) or the `confirmationCode` the guest knows. Returns not-found unless the reservation belongs to that email.',
    audiences: ['admin'],
    scopes: ['bookings:read'],
    input: LookupReservationInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupReservation(args: z.infer<typeof LookupReservationInput>) {
    return this.bookings.lookupReservation(args);
  }
}
