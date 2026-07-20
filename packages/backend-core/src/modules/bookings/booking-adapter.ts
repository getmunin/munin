import type { ConnectorAdapter, ConnectorConnectionContext } from '../connectors/connector.ts';

/**
 * Bookings-domain connector contract (restaurant/venue bookings). Every
 * query takes the guest's email and the adapter is responsible for enforcing
 * ownership — a booking that does not belong to that email must come back
 * as `null` / excluded, never as data. The service layer resolves which email
 * to use (the calling end-user's, or an admin-supplied one) and never lets a
 * self-service caller choose it.
 *
 * Read-only by design: changing or cancelling a booking is a future
 * propose-only flow (outreach-style), not a direct end-user mutation.
 */
export interface BookingAdapter extends ConnectorAdapter {
  readonly domain: 'bookings';

  listBookingsForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<BookingSummary[]>;

  /**
   * Fetch one booking by adapter-native ref or the confirmation code the
   * guest knows, returning `null` when it does not exist OR does not belong
   * to `email` (indistinguishable on purpose).
   */
  getBookingForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; bookingRef?: string; confirmationCode?: string },
  ): Promise<BookingDetail | null>;
}

export interface BookingSummary {
  /** Adapter-native booking id; pass back to bookings_get_my_booking. */
  bookingRef: string;
  /** Human-facing confirmation code from the booking confirmation, when the vendor has one. */
  confirmationCode: string | null;
  status: string;
  venue: string | null;
  /** Venue-local start time (ISO 8601 without zone — vendors don't expose the venue timezone). */
  startsAt: string;
  durationMinutes: number | null;
  partySize: number;
}

export interface BookingDetail extends BookingSummary {
  note: string | null;
}
