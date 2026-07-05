import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { BookingsService } from './bookings.service.ts';

const GetMyReservationsInput = z.object({
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

const GetMyReservationInput = z.object({
  connectionId: z.string().min(1).optional(),
  reservationRef: z.string().min(1).max(64).optional(),
  confirmationCode: z.string().min(1).max(64).optional(),
});

@Injectable()
export class BookingSelfServiceTools {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  @McpTool({
    name: 'bookings_get_my_reservations',
    title: 'Bookings: My reservations',
    description:
      'List the calling end-user’s restaurant/venue reservations (most recent first). Scoped server-side to the email on the end-user’s own record — other guests’ reservations are never visible. `connectionId` is only needed when the org has multiple active booking connections.',
    audiences: ['self_service'],
    scopes: ['bookings:read'],
    input: GetMyReservationsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyReservations(args: z.infer<typeof GetMyReservationsInput>) {
    return this.bookings.getMyReservations(args);
  }

  @McpTool({
    name: 'bookings_get_my_reservation',
    title: 'Bookings: One of my reservations',
    description:
      'Fetch one of the calling end-user’s reservations, including party size, time, venue, and note. Identify it by `reservationRef` (from a listing) or the `confirmationCode` on the booking confirmation. Returns not-found unless the reservation belongs to the calling end-user.',
    audiences: ['self_service'],
    scopes: ['bookings:read'],
    input: GetMyReservationInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyReservation(args: z.infer<typeof GetMyReservationInput>) {
    return this.bookings.getMyReservation(args);
  }
}
