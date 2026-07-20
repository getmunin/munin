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

const CreateMyBookingInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM'),
  partySize: z.number().int().min(1).max(1000),
  seatingTime: z.number().int().min(1).max(1440).optional(),
  areaId: z.number().int().min(1).optional(),
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(1).max(32).optional(),
  note: z.string().max(1000).optional(),
  connectionId: z.string().min(1).optional(),
});

const UpdateMyBookingInput = z.object({
  bookingRef: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM').optional(),
  partySize: z.number().int().min(1).max(1000).optional(),
  note: z.string().max(1000).optional(),
  connectionId: z.string().min(1).optional(),
});

const CancelMyBookingInput = z.object({
  bookingRef: z.string().min(1).max(64),
  connectionId: z.string().min(1).optional(),
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
      'Fetch one of the calling end-user’s bookings, including party size, start time, and duration. Identify it by `bookingRef` from a listing, or `confirmationCode` where the venue’s system issues one. Returns not-found unless the booking belongs to the calling end-user.',
    audiences: ['self_service'],
    scopes: ['bookings:read'],
    input: GetMyBookingInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyBooking(args: z.infer<typeof GetMyBookingInput>) {
    return this.bookings.getMyBooking(args);
  }

  @McpTool({
    name: 'bookings_create_my_booking',
    title: 'Bookings: Book a table for me',
    description:
      'Create a booking for the calling end-user at a date and time for a party size. The booking is made under the end-user’s own email — you cannot book on behalf of anyone else. Check bookings_check_availability first.',
    audiences: ['self_service'],
    scopes: ['bookings:write'],
    input: CreateMyBookingInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createMyBooking(args: z.infer<typeof CreateMyBookingInput>) {
    return this.bookings.createMyBooking(args);
  }

  @McpTool({
    name: 'bookings_update_my_booking',
    title: 'Bookings: Modify my booking',
    description:
      'Change one of the calling end-user’s own bookings (date, time, party size, or note) by `bookingRef`. Returns not-found unless the booking belongs to the calling end-user.',
    audiences: ['self_service'],
    scopes: ['bookings:write'],
    input: UpdateMyBookingInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateMyBooking(args: z.infer<typeof UpdateMyBookingInput>) {
    return this.bookings.updateMyBooking(args);
  }

  @McpTool({
    name: 'bookings_cancel_my_booking',
    title: 'Bookings: Cancel my booking',
    description:
      'Cancel one of the calling end-user’s own bookings by `bookingRef`. Returns not-found unless the booking belongs to the calling end-user. This cannot be undone.',
    audiences: ['self_service'],
    scopes: ['bookings:write'],
    input: CancelMyBookingInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  cancelMyBooking(args: z.infer<typeof CancelMyBookingInput>) {
    return this.bookings.cancelMyBooking(args);
  }
}
