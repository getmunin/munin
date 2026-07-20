import type { ConnectorAdapter, ConnectorConnectionContext } from '../connectors/connector.ts';

export interface BookingAdapter extends ConnectorAdapter {
  readonly domain: 'bookings';

  listBookingsForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<BookingSummary[]>;

  getBookingForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; bookingRef?: string; confirmationCode?: string },
  ): Promise<BookingDetail | null>;

  checkAvailability?(
    ctx: ConnectorConnectionContext,
    args: { date: string; partySize: number; seatingTime?: number },
  ): Promise<BookingAvailabilitySlot[]>;

  createBooking?(
    ctx: ConnectorConnectionContext,
    args: BookingCreateInput,
  ): Promise<{ bookingRef: string }>;

  updateBooking?(
    ctx: ConnectorConnectionContext,
    args: { bookingRef: string } & BookingUpdateInput,
  ): Promise<void>;

  cancelBooking?(
    ctx: ConnectorConnectionContext,
    args: { bookingRef: string },
  ): Promise<void>;
}

export interface BookingAvailabilitySlot {
  time: string;
  available: boolean;
  seatingTime: number | null;
  areaId: number | null;
  areaName: string | null;
}

export interface BookingCreateInput {
  email: string;
  date: string;
  time: string;
  partySize: number;
  seatingTime?: number;
  areaId?: number;
  name?: string;
  phone?: string;
  note?: string;
}

export interface BookingUpdateInput {
  date?: string;
  time?: string;
  partySize?: number;
  note?: string;
}

export interface BookingSummary {
  bookingRef: string;
  confirmationCode: string | null;
  status: string;
  venue: string | null;
  startsAt: string;
  durationMinutes: number | null;
  partySize: number;
}

export interface BookingDetail extends BookingSummary {
  note: string | null;
}
