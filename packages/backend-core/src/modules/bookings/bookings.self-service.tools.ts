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
  email: z.string().trim().email().max(254).optional(),
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
    name: 'bookings_list_my_bookings',
    title: 'Bookings: List my bookings',
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
    title: 'Bookings: Get one of my bookings',
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
    title: 'Bookings: Create my booking',
    description:
      'Create a booking at a date and time for a party size. A session with a verified email books under that email and cannot book under any other. A session without one, such as an anonymous chat or a phone call, books under the guest email passed in `email` (on a call the phone defaults to the caller\'s number); it may make up to 3 bookings per conversation, and may later change or cancel only those. Check bookings_check_availability first.',
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
    title: 'Bookings: Update my booking',
    description:
      'Change a booking (date, time, party size, or note) by `bookingRef`: one of the calling end-user’s own bookings, or one made earlier in this same conversation. Returns not-found for any other booking.',
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
      'Cancel a booking by `bookingRef`: one of the calling end-user’s own bookings, or one made earlier in this same conversation. Returns not-found for any other booking. This cannot be undone.',
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
