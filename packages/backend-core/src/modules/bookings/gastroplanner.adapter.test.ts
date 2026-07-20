import { describe, expect, it } from 'vitest';
import { GastroplannerAdapter } from './gastroplanner.adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../connectors/http.ts';
import type { ConnectorConnectionContext } from '../connectors/connector.ts';

function stubRest(
  respond: (url: string) => { status?: number; body: unknown },
): { fetch: ConnectorFetch; urls: string[]; headers: Array<Record<string, string>> } {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetch: ConnectorFetch = (url, init) => {
    urls.push(url);
    headers.push((init.headers as Record<string, string>) ?? {});
    const { status = 200, body } = respond(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
  return { fetch, urls, headers };
}

function ctx(): ConnectorConnectionContext {
  return {
    config: {
      baseUrl: 'https://api.gastroplanner.eu',
      restaurantUri: 'bryggen-bistro',
      encryptedApiToken: 'ct_abc',
    },
    decryptSecret: () => Promise.resolve('partner_token'),
  };
}

const booking = (over: Record<string, unknown> = {}) => ({
  id: 512,
  date: '2026-07-10',
  time: '19:00',
  seating_time: 120,
  pax: 4,
  area_id: 2,
  session_id: 9,
  customer_id: 7,
  status: 'confirmed',
  origin: 1,
  lang: 'nb',
  tables: [{ id: 3, name: 'T3' }],
  products: [],
  customer: { id: 7, first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
  ...over,
});

describe('GastroplannerAdapter', () => {
  it('lists bookings via the customer API with the lowercased guest email and restaurant header', async () => {
    const { fetch, urls, headers } = stubRest(() => ({ body: [booking()] }));
    const adapter = new GastroplannerAdapter(fetch);

    const bookings = await adapter.listBookingsForGuest(ctx(), {
      email: 'Jane@Example.com',
      limit: 5,
    });

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe('/customer/v1/bookings');
    expect(url.searchParams.get('email')).toBe('jane@example.com');
    expect(headers[0]!['x-restaurant']).toBe('bryggen-bistro');
    expect(bookings[0]).toEqual({
      bookingRef: '512',
      confirmationCode: null,
      status: 'confirmed',
      venue: null,
      startsAt: '2026-07-10T19:00:00',
      durationMinutes: 120,
      partySize: 4,
    });
  });

  it('sorts newest-first and applies the limit client-side', async () => {
    const { fetch } = stubRest(() => ({
      body: [
        booking({ id: 1, date: '2026-07-01' }),
        booking({ id: 3, date: '2026-07-20' }),
        booking({ id: 2, date: '2026-07-10' }),
      ],
    }));
    const adapter = new GastroplannerAdapter(fetch);

    const bookings = await adapter.listBookingsForGuest(ctx(), {
      email: 'jane@example.com',
      limit: 2,
    });

    expect(bookings.map((b) => b.bookingRef)).toEqual(['3', '2']);
  });

  it('unwraps { data: … } envelopes and drops bookings owned by someone else', async () => {
    const { fetch } = stubRest(() => ({
      body: {
        data: [booking(), booking({ customer: { id: 8, email: 'mallory@example.com' } })],
      },
    }));
    const adapter = new GastroplannerAdapter(fetch);

    const bookings = await adapter.listBookingsForGuest(ctx(), {
      email: 'jane@example.com',
      limit: 5,
    });

    expect(bookings).toHaveLength(1);
  });

  it('fetches one booking by ref, enforcing ownership', async () => {
    const { fetch, urls } = stubRest(() => ({ body: [booking()] }));
    const adapter = new GastroplannerAdapter(fetch);

    const owned = await adapter.getBookingForGuest(ctx(), {
      email: 'jane@example.com',
      bookingRef: '512',
    });
    const foreign = await adapter.getBookingForGuest(ctx(), {
      email: 'mallory@example.com',
      bookingRef: '512',
    });

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe('/customer/v1/bookings');
    expect(url.searchParams.get('id')).toBe('512');
    expect(owned?.partySize).toBe(4);
    expect(foreign).toBeNull();
  });

  it('returns null for a confirmation-code lookup (Gastroplanner issues no codes)', async () => {
    const { fetch, urls } = stubRest(() => ({ body: [booking()] }));
    const adapter = new GastroplannerAdapter(fetch);

    const found = await adapter.getBookingForGuest(ctx(), {
      email: 'jane@example.com',
      confirmationCode: 'GP-7F3K',
    });

    expect(found).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it('returns null when the booking id does not exist', async () => {
    const { fetch } = stubRest(() => ({ body: [] }));
    const adapter = new GastroplannerAdapter(fetch);

    const found = await adapter.getBookingForGuest(ctx(), {
      email: 'jane@example.com',
      bookingRef: '999',
    });

    expect(found).toBeNull();
  });

  it('rejects a non-numeric bookingRef without calling the vendor', async () => {
    const { fetch, urls } = stubRest(() => ({ body: [] }));
    const adapter = new GastroplannerAdapter(fetch);

    const found = await adapter.getBookingForGuest(ctx(), {
      email: 'jane@example.com',
      bookingRef: '../restaurants',
    });

    expect(found).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it('verifies the configured restaurant is accessible on testConnection', async () => {
    const ok = new GastroplannerAdapter(
      stubRest(() => ({ body: ['bryggen-bistro', 'other-place'] })).fetch,
    );
    await expect(ok.testConnection(ctx())).resolves.toEqual({
      ok: true,
      detail: 'connected to bryggen-bistro',
    });

    const wrong = new GastroplannerAdapter(stubRest(() => ({ body: ['other-place'] })).fetch);
    await expect(wrong.testConnection(ctx())).rejects.toThrow(/cannot access restaurant/);
  });

  it('maps 401 responses to a vendor error', async () => {
    const { fetch } = stubRest(() => ({ status: 401, body: {} }));
    const adapter = new GastroplannerAdapter(fetch);

    await expect(adapter.testConnection(ctx())).rejects.toBeInstanceOf(ConnectorVendorError);
  });

  describe('buildStoredConfig', () => {
    const adapter = new GastroplannerAdapter(stubRest(() => ({ body: {} })).fetch);
    const encrypt = (plain: string) => Promise.resolve(`enc(${plain})`);

    it('defaults the base url, keeps the restaurant uri, and encrypts the token', async () => {
      const stored = await adapter.buildStoredConfig(
        { apiToken: 'partner_token', restaurantUri: 'bryggen-bistro' },
        encrypt,
      );
      expect(stored).toEqual({
        baseUrl: 'https://api.gastroplanner.eu',
        restaurantUri: 'bryggen-bistro',
        encryptedApiToken: 'enc(partner_token)',
      });
    });

    it('keeps the previous ciphertext when apiToken is omitted on update', async () => {
      const stored = await adapter.buildStoredConfig({ restaurantUri: 'bryggen-bistro' }, encrypt, {
        baseUrl: 'https://api.gastroplanner.eu',
        restaurantUri: 'bryggen-bistro',
        encryptedApiToken: 'ct_old',
      });
      expect(stored.encryptedApiToken).toBe('ct_old');
    });

    it('requires a token when there is no previous config', async () => {
      await expect(
        adapter.buildStoredConfig({ restaurantUri: 'bryggen-bistro' }, encrypt),
      ).rejects.toBeInstanceOf(ConnectorVendorError);
    });
  });
});
