import { z } from 'zod';
import { safeFetch } from '@getmunin/core';
import type {
  ConnectorConfigFieldInfo,
  ConnectorConnectionContext,
  ConnectorTestResult,
} from '../connector.ts';
import { normalizeEmail } from '../connector.ts';
import { ConnectorVendorError, type ConnectorFetch, REQUEST_TIMEOUT_MS } from '../http.ts';
import type {
  BookingAdapter,
  BookingReservationDetail,
  BookingReservationSummary,
} from './booking-adapter.ts';

// Gastroplanner's partner API is not publicly documented (tokens are issued
// by their support). The booking model below matches their published
// integration adapters (id, date, time, seating duration, guest count,
// enquiry flag, note); the endpoint paths are centralized here so they can
// be corrected in one place against a live token, and `baseUrl` is
// overridable per connection.
const DEFAULT_BASE_URL = 'https://api.gastroplanner.no';
const ENDPOINTS = {
  test: '/v1/venues',
  bookings: '/v1/bookings',
  booking: (id: string) => `/v1/bookings/${id}`,
};

export const GastroplannerConfigInput = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), 'baseUrl must be https')
    .transform((u) => u.replace(/\/+$/, ''))
    .default(DEFAULT_BASE_URL),
  /** Partner API token (request via Gastroplanner support). Optional on update to keep the stored one. */
  apiToken: z.string().min(10).max(256).optional(),
});

const StoredGastroplannerConfig = z.object({
  baseUrl: z.string(),
  encryptedApiToken: z.string(),
});

interface GastroplannerBooking {
  id: number | string;
  date: string;
  time: string;
  seating_time?: number | null;
  number_of_guests: number;
  status?: string | null;
  note?: string | null;
  confirmation_code?: string | null;
  venue?: { name?: string | null } | null;
  venue_name?: string | null;
  customer?: { email?: string | null } | null;
  email?: string | null;
}

export class GastroplannerAdapter implements BookingAdapter {
  readonly vendor = 'gastroplanner';
  readonly domain = 'bookings' as const;
  readonly displayName = 'Gastroplanner';
  readonly configInput = GastroplannerConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'apiToken',
      label: 'Partner API token (request via support@gastroplanner.no)',
      required: true,
      secret: true,
    },
    {
      key: 'baseUrl',
      label: `API base URL (default ${DEFAULT_BASE_URL})`,
      required: false,
      placeholder: DEFAULT_BASE_URL,
    },
  ];

  constructor(private readonly fetchImpl: ConnectorFetch = safeFetch) {}

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = GastroplannerConfigInput.parse(input);
    const prev = previous ? StoredGastroplannerConfig.safeParse(previous) : null;
    const encryptedApiToken = parsed.apiToken
      ? await encryptSecret(parsed.apiToken)
      : prev?.success
        ? prev.data.encryptedApiToken
        : null;
    if (!encryptedApiToken) {
      throw new ConnectorVendorError(
        'apiToken is required when creating a Gastroplanner connection',
      );
    }
    return { baseUrl: parsed.baseUrl, encryptedApiToken };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    const parsed = StoredGastroplannerConfig.parse(stored);
    return { baseUrl: parsed.baseUrl };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const venues = await this.get<unknown[]>(ctx, ENDPOINTS.test);
    return { ok: true, detail: `connected; ${venues.length} venue(s) visible` };
  }

  async listReservationsForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<BookingReservationSummary[]> {
    const params = new URLSearchParams({
      email: normalizeEmail(args.email),
      limit: String(args.limit),
      sort: '-date',
    });
    const bookings = await this.get<GastroplannerBooking[]>(
      ctx,
      `${ENDPOINTS.bookings}?${params.toString()}`,
    );
    return bookings
      .filter((b) => this.ownedBy(b, args.email))
      .slice(0, args.limit)
      .map((b) => this.toSummary(b));
  }

  async getReservationForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; reservationRef?: string; confirmationCode?: string },
  ): Promise<BookingReservationDetail | null> {
    const booking = args.reservationRef
      ? await this.bookingById(ctx, args.reservationRef)
      : args.confirmationCode
        ? await this.bookingByConfirmationCode(ctx, args.confirmationCode, args.email)
        : null;
    if (!booking || !this.ownedBy(booking, args.email)) return null;
    return this.toDetail(booking);
  }

  private async bookingById(
    ctx: ConnectorConnectionContext,
    reservationRef: string,
  ): Promise<GastroplannerBooking | null> {
    if (!/^\d+$/.test(reservationRef)) return null;
    try {
      return await this.get<GastroplannerBooking>(ctx, ENDPOINTS.booking(reservationRef));
    } catch (err) {
      if (err instanceof ConnectorVendorError && err.notFound) return null;
      throw err;
    }
  }

  private async bookingByConfirmationCode(
    ctx: ConnectorConnectionContext,
    confirmationCode: string,
    email: string,
  ): Promise<GastroplannerBooking | null> {
    const normalized = confirmationCode.trim();
    if (!normalized) return null;
    const params = new URLSearchParams({
      email: normalizeEmail(email),
      confirmation_code: normalized,
    });
    const bookings = await this.get<GastroplannerBooking[]>(
      ctx,
      `${ENDPOINTS.bookings}?${params.toString()}`,
    );
    return bookings.find((b) => (b.confirmation_code ?? '').trim() === normalized) ?? null;
  }

  private ownedBy(booking: GastroplannerBooking, email: string): boolean {
    const bookingEmail = booking.customer?.email ?? booking.email;
    return !!bookingEmail && normalizeEmail(bookingEmail) === normalizeEmail(email);
  }

  private toSummary(booking: GastroplannerBooking): BookingReservationSummary {
    return {
      reservationRef: String(booking.id),
      confirmationCode: booking.confirmation_code ?? null,
      status: booking.status?.toLowerCase() ?? 'confirmed',
      venue: booking.venue?.name ?? booking.venue_name ?? null,
      startsAt: `${booking.date}T${booking.time.length === 5 ? `${booking.time}:00` : booking.time}`,
      durationMinutes: booking.seating_time ?? null,
      partySize: booking.number_of_guests,
    };
  }

  private toDetail(booking: GastroplannerBooking): BookingReservationDetail {
    return { ...this.toSummary(booking), note: booking.note ?? null };
  }

  private async get<T>(ctx: ConnectorConnectionContext, path: string): Promise<T> {
    const config = StoredGastroplannerConfig.parse(ctx.config);
    const apiToken = await ctx.decryptSecret(config.encryptedApiToken);
    const res = await this.fetchImpl(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorVendorError('gastroplanner rejected the API token (401/403)');
    }
    if (res.status === 404) {
      throw Object.assign(new ConnectorVendorError('gastroplanner resource not found'), {
        notFound: true,
      });
    }
    if (!res.ok) {
      throw new ConnectorVendorError(`gastroplanner request failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as T | { data: T };
    return unwrapData(body);
  }
}

/** Some Gastroplanner responses wrap payloads in { data: … }; accept both shapes. */
function unwrapData<T>(body: T | { data: T }): T {
  return isEnvelope(body) ? body.data : body;
}

function isEnvelope<T>(body: T | { data: T }): body is { data: T } {
  return !!body && typeof body === 'object' && 'data' in body && Object.keys(body).length === 1;
}
