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

const AvailabilityInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  partySize: z.number().int().min(1).max(1000),
  seatingTime: z.number().int().min(1).max(1440).optional(),
  connectionId: z.string().min(1).optional(),
});

const CreateBookingInput = z.object({
  email: z.string().email(),
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

const UpdateBookingInput = z.object({
  bookingRef: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM').optional(),
  partySize: z.number().int().min(1).max(1000).optional(),
  note: z.string().max(1000).optional(),
  connectionId: z.string().min(1).optional(),
});

const CancelBookingInput = z.object({
  bookingRef: z.string().min(1).max(64),
  connectionId: z.string().min(1).optional(),
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

  @McpTool({
    name: 'bookings_check_availability',
    title: 'Bookings: Check table availability',
    description:
      'List open time slots for a date and party size at the connected booking system, so you can offer real times before creating a booking. `connectionId` is only needed when multiple booking connections are active.',
    audiences: ['admin', 'self_service'],
    scopes: ['bookings:read'],
    input: AvailabilityInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  checkAvailability(args: z.infer<typeof AvailabilityInput>) {
    return this.bookings.checkAvailability(args);
  }

  @McpTool({
    name: 'bookings_create_booking',
    title: 'Bookings: Book a table',
    description:
      'Create a booking in the connected booking system for a guest email at a date and time, for a given party size. Check bookings_check_availability first. Returns the new bookingRef.',
    audiences: ['admin'],
    scopes: ['bookings:write'],
    input: CreateBookingInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createBooking(args: z.infer<typeof CreateBookingInput>) {
    return this.bookings.createBooking(args);
  }

  @McpTool({
    name: 'bookings_update_booking',
    title: 'Bookings: Modify a booking',
    description:
      'Change an existing booking (date, time, party size, or note) by `bookingRef`. Only the fields you pass are changed.',
    audiences: ['admin'],
    scopes: ['bookings:write'],
    input: UpdateBookingInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateBooking(args: z.infer<typeof UpdateBookingInput>) {
    return this.bookings.updateBooking(args);
  }

  @McpTool({
    name: 'bookings_cancel_booking',
    title: 'Bookings: Cancel a booking',
    description:
      'Cancel an existing booking by `bookingRef` in the connected booking system. This cannot be undone.',
    audiences: ['admin'],
    scopes: ['bookings:write'],
    input: CancelBookingInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  cancelBooking(args: z.infer<typeof CancelBookingInput>) {
    return this.bookings.cancelBooking(args);
  }
}
