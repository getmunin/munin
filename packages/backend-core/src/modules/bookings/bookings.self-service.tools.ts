import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { BookingsService } from './bookings.service.ts';

const GetMyBookingsInput = z.object({
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

const GetMyBookingInput = z.object({
  connectionId: z.string().min(1).optional(),
  bookingRef: z.string().min(1).max(64).optional(),
  confirmationCode: z.string().min(1).max(64).optional(),
});

@Injectable()
export class BookingSelfServiceTools {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  @McpTool({
    name: 'bookings_get_my_bookings',
    title: 'Bookings: My bookings',
    description:
      'List the calling end-user’s restaurant/venue bookings (most recent first). Scoped server-side to the email on the end-user’s own record — other guests’ bookings are never visible. `connectionId` is only needed when the org has multiple active booking connections.',
    audiences: ['self_service'],
    scopes: ['bookings:read'],
    input: GetMyBookingsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyBookings(args: z.infer<typeof GetMyBookingsInput>) {
    return this.bookings.getMyBookings(args);
  }

  @McpTool({
    name: 'bookings_get_my_booking',
    title: 'Bookings: One of my bookings',
    description:
      'Fetch one of the calling end-user’s bookings, including party size, time, venue, and note. Identify it by `bookingRef` (from a listing) or the `confirmationCode` on the booking confirmation. Returns not-found unless the booking belongs to the calling end-user.',
    audiences: ['self_service'],
    scopes: ['bookings:read'],
    input: GetMyBookingInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyBooking(args: z.infer<typeof GetMyBookingInput>) {
    return this.bookings.getMyBooking(args);
  }
}
