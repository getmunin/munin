import { z } from 'zod';
import { safeFetch } from '@getmunin/core';
import type {
  ConnectorConfigFieldInfo,
  ConnectorConnectionContext,
  ConnectorTestResult,
} from '../connectors/connector.ts';
import { normalizeEmail } from '../connectors/connector.ts';
import { ConnectorVendorError, type ConnectorFetch, REQUEST_TIMEOUT_MS } from '../connectors/http.ts';
import type {
  BookingAdapter,
  BookingDetail,
  BookingSummary,
} from './booking-adapter.ts';

// Customer API per https://api.gastroplanner.eu/docs/customer/ — every call
// carries the Bearer token plus an X-RESTAURANT header naming the restaurant
// the query runs against. GET customer/v1/bookings filters by email/id
// server-side; the booking API (docs/booking/) only filters by date, so it is
// deliberately not used here.
const DEFAULT_BASE_URL = 'https://api.gastroplanner.eu';
const ENDPOINTS = {
  restaurants: '/customer/v1/restaurants',
  bookings: '/customer/v1/bookings',
};

export const GastroplannerConfigInput = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), 'baseUrl must be https')
    .transform((u) => u.replace(/\/+$/, ''))
    .default(DEFAULT_BASE_URL),
  /** Restaurant URI sent as the X-RESTAURANT header; connectors_test_connection lists the URIs the token can access. */
  restaurantUri: z.string().trim().min(1).max(128),
  /** Partner API token (request via Gastroplanner support). Optional on update to keep the stored one. */
  apiToken: z.string().min(10).max(256).optional(),
});

const StoredGastroplannerConfig = z.object({
  baseUrl: z.string(),
  restaurantUri: z.string(),
  encryptedApiToken: z.string(),
});

interface GastroplannerBooking {
  id: number | string;
  date: string;
  time: string;
  seating_time?: number | null;
  pax: number;
  status?: string | null;
  customer?: { email?: string | null } | null;
}

export class GastroplannerAdapter implements BookingAdapter {
  readonly vendor = 'gastroplanner';
  readonly domain = 'bookings' as const;
  readonly displayName = 'Gastroplanner';
  readonly configInput = GastroplannerConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'apiToken',
      label: 'Partner API token (issued by Gastroplanner support)',
      required: true,
      secret: true,
    },
    {
      key: 'restaurantUri',
      label: 'Restaurant URI (X-RESTAURANT header value)',
      required: true,
      placeholder: 'my-restaurant',
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
    return { baseUrl: parsed.baseUrl, restaurantUri: parsed.restaurantUri, encryptedApiToken };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    const parsed = StoredGastroplannerConfig.parse(stored);
    return { baseUrl: parsed.baseUrl, restaurantUri: parsed.restaurantUri };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const config = StoredGastroplannerConfig.parse(ctx.config);
    const restaurants = await this.get<string[]>(ctx, ENDPOINTS.restaurants);
    if (!restaurants.includes(config.restaurantUri)) {
      throw new ConnectorVendorError(
        `token cannot access restaurant "${config.restaurantUri}"; available: ${restaurants.join(', ') || '(none)'}`,
      );
    }
    return { ok: true, detail: `connected to ${config.restaurantUri}` };
  }

  async listBookingsForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; limit: number },
  ): Promise<BookingSummary[]> {
    const params = new URLSearchParams({ email: normalizeEmail(args.email) });
    const bookings = await this.get<GastroplannerBooking[]>(
      ctx,
      `${ENDPOINTS.bookings}?${params.toString()}`,
    );
    return bookings
      .filter((b) => this.ownedBy(b, args.email))
      .sort((a, b) => startsAt(b).localeCompare(startsAt(a)))
      .slice(0, args.limit)
      .map((b) => this.toSummary(b));
  }

  async getBookingForGuest(
    ctx: ConnectorConnectionContext,
    args: { email: string; bookingRef?: string; confirmationCode?: string },
  ): Promise<BookingDetail | null> {
    // Gastroplanner issues no confirmation code — bookings are identified by
    // their numeric id (the bookingRef from a listing).
    if (!args.bookingRef || !/^\d+$/.test(args.bookingRef)) return null;
    const params = new URLSearchParams({
      id: args.bookingRef,
      email: normalizeEmail(args.email),
    });
    const bookings = await this.get<GastroplannerBooking[]>(
      ctx,
      `${ENDPOINTS.bookings}?${params.toString()}`,
    );
    const booking = bookings.find(
      (b) => String(b.id) === args.bookingRef && this.ownedBy(b, args.email),
    );
    return booking ? this.toDetail(booking) : null;
  }

  private ownedBy(booking: GastroplannerBooking, email: string): boolean {
    const bookingEmail = booking.customer?.email;
    return !!bookingEmail && normalizeEmail(bookingEmail) === normalizeEmail(email);
  }

  private toSummary(booking: GastroplannerBooking): BookingSummary {
    return {
      bookingRef: String(booking.id),
      confirmationCode: null,
      status: booking.status?.toLowerCase() ?? 'confirmed',
      venue: null,
      startsAt: startsAt(booking),
      durationMinutes: booking.seating_time ?? null,
      partySize: booking.pax,
    };
  }

  private toDetail(booking: GastroplannerBooking): BookingDetail {
    return { ...this.toSummary(booking), note: null };
  }

  private async get<T>(ctx: ConnectorConnectionContext, path: string): Promise<T> {
    const config = StoredGastroplannerConfig.parse(ctx.config);
    const apiToken = await ctx.decryptSecret(config.encryptedApiToken);
    const res = await this.fetchImpl(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'x-restaurant': config.restaurantUri,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorVendorError('gastroplanner rejected the API token (401/403)');
    }
    if (!res.ok) {
      throw new ConnectorVendorError(`gastroplanner request failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as T | { data: T };
    return unwrapData(body);
  }
}

function startsAt(booking: GastroplannerBooking): string {
  return `${booking.date}T${booking.time.length === 5 ? `${booking.time}:00` : booking.time}`;
}

/** Some Gastroplanner responses wrap payloads in { data: … }; accept both shapes. */
function unwrapData<T>(body: T | { data: T }): T {
  return isEnvelope(body) ? body.data : body;
}

function isEnvelope<T>(body: T | { data: T }): body is { data: T } {
  return !!body && typeof body === 'object' && 'data' in body && Object.keys(body).length === 1;
}
