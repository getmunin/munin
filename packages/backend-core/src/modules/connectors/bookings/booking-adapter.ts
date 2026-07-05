import type { ConnectorAdapter, ConnectorConnectionContext } from '../connector.ts';

/**
 * Bookings-domain connector contract (restaurant/venue reservations). Every
 * query takes the guest's email and the adapter is responsible for enforcing
 * ownership — a reservation that does not belong to that email must come back
 * as `null` / excluded, never as data. The service layer resolves which email
 * to use (the calling end-user's, or an admin-supplied one) and never lets a
 * self-service caller choose it.
 *
 * Read-only by design: changing or cancelling a reservation is a future
 * propose-only flow (outreach-style), not a direct end-user mutation.
 */
export interface BookingAdapter extends ConnectorAdapter {
  readonly domain: 'bookings';

  listReservationsForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<BookingReservationSummary[]>;

  /**
   * Fetch one reservation by adapter-native ref or the confirmation code the
   * guest knows, returning `null` when it does not exist OR does not belong
   * to `email` (indistinguishable on purpose).
   */
  getReservationForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; reservationRef?: string; confirmationCode?: string },
  ): Promise<BookingReservationDetail | null>;
}

export interface BookingReservationSummary {
  /** Adapter-native reservation id; pass back to bookings_get_my_reservation. */
  reservationRef: string;
  /** Human-facing confirmation code from the booking confirmation, when the vendor has one. */
  confirmationCode: string | null;
  status: string;
  venue: string | null;
  /** Venue-local start time (ISO 8601 without zone — vendors don't expose the venue timezone). */
  startsAt: string;
  durationMinutes: number | null;
  partySize: number;
}

export interface BookingReservationDetail extends BookingReservationSummary {
  note: string | null;
}
