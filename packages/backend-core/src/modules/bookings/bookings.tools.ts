import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { BookingsService } from './bookings.service.ts';

const LookupBookingsInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const LookupBookingInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  bookingRef: z.string().min(1).max(64).optional(),
  confirmationCode: z.string().min(1).max(64).optional(),
});

@Injectable()
export class BookingAdminTools {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  @McpTool({
    name: 'bookings_lookup_bookings',
    title: 'Bookings: Look up a guest’s bookings',
    description:
      'List a guest’s bookings by email (most recent first), e.g. while handling their support conversation. `connectionId` is only needed when multiple booking connections are active.',
    audiences: ['admin'],
    scopes: ['bookings:read'],
    input: LookupBookingsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupBookings(args: z.infer<typeof LookupBookingsInput>) {
    return this.bookings.lookupBookings(args);
  }

  @McpTool({
    name: 'bookings_lookup_booking',
    title: 'Bookings: Look up one booking',
    description:
      'Fetch one booking for a guest email, including party size, start time, and duration. Identify it by `bookingRef` from a listing, or `confirmationCode` where the venue’s system issues one. Returns not-found unless the booking belongs to that email.',
    audiences: ['admin'],
    scopes: ['bookings:read'],
    input: LookupBookingInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupBooking(args: z.infer<typeof LookupBookingInput>) {
    return this.bookings.lookupBooking(args);
  }
}
