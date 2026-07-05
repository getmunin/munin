import { describe, expect, it } from 'vitest';
import { GastroplannerAdapter } from './gastroplanner.adapter.ts';
import { ConnectorVendorError, type ConnectorFetch } from '../http.ts';
import type { ConnectorConnectionContext } from '../connector.ts';

function stubRest(
  respond: (url: string) => { status?: number; body: unknown },
): { fetch: ConnectorFetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: ConnectorFetch = (url) => {
    urls.push(url);
    const { status = 200, body } = respond(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
  return { fetch, urls };
}

function ctx(): ConnectorConnectionContext {
  return {
    config: { baseUrl: 'https://api.gastroplanner.no', encryptedApiToken: 'ct_abc' },
    decryptSecret: () => Promise.resolve('partner_token'),
  };
}

const booking = (over: Record<string, unknown> = {}) => ({
  id: 512,
  date: '2026-07-10',
  time: '19:00',
  seating_time: 120,
  number_of_guests: 4,
  status: 'Confirmed',
  note: 'Window table please',
  confirmation_code: 'GP-7F3K',
  venue: { name: 'Bryggen Bistro' },
  customer: { email: 'jane@example.com' },
  ...over,
});

describe('GastroplannerAdapter', () => {
  it('lists reservations filtered by lowercased guest email', async () => {
    const { fetch, urls } = stubRest(() => ({ body: [booking()] }));
    const adapter = new GastroplannerAdapter(fetch);

    const reservations = await adapter.listReservationsForGuest(ctx(), {
      email: 'Jane@Example.com',
      limit: 5,
    });

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe('/v1/bookings');
    expect(url.searchParams.get('email')).toBe('jane@example.com');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(reservations[0]).toEqual({
      reservationRef: '512',
      confirmationCode: 'GP-7F3K',
      status: 'confirmed',
      venue: 'Bryggen Bistro',
      startsAt: '2026-07-10T19:00:00',
      durationMinutes: 120,
      partySize: 4,
    });
  });

  it('unwraps { data: … } envelopes and drops reservations owned by someone else', async () => {
    const { fetch } = stubRest(() => ({
      body: { data: [booking(), booking({ customer: { email: 'mallory@example.com' } })] },
    }));
    const adapter = new GastroplannerAdapter(fetch);

    const reservations = await adapter.listReservationsForGuest(ctx(), {
      email: 'jane@example.com',
      limit: 5,
    });

    expect(reservations).toHaveLength(1);
  });

  it('fetches one reservation by ref with the note, enforcing ownership', async () => {
    const { fetch, urls } = stubRest(() => ({ body: booking() }));
    const adapter = new GastroplannerAdapter(fetch);

    const owned = await adapter.getReservationForGuest(ctx(), {
      email: 'jane@example.com',
      reservationRef: '512',
    });
    const foreign = await adapter.getReservationForGuest(ctx(), {
      email: 'mallory@example.com',
      reservationRef: '512',
    });

    expect(urls[0]).toContain('/v1/bookings/512');
    expect(owned?.note).toBe('Window table please');
    expect(foreign).toBeNull();
  });

  it('finds a reservation by confirmation code scoped to the guest email', async () => {
    const { fetch, urls } = stubRest(() => ({ body: [booking()] }));
    const adapter = new GastroplannerAdapter(fetch);

    const found = await adapter.getReservationForGuest(ctx(), {
      email: 'jane@example.com',
      confirmationCode: 'GP-7F3K',
    });

    const url = new URL(urls[0]!);
    expect(url.searchParams.get('confirmation_code')).toBe('GP-7F3K');
    expect(url.searchParams.get('email')).toBe('jane@example.com');
    expect(found?.confirmationCode).toBe('GP-7F3K');
  });

  it('returns null when the reservation id does not exist (404)', async () => {
    const { fetch } = stubRest(() => ({ status: 404, body: { message: 'not found' } }));
    const adapter = new GastroplannerAdapter(fetch);

    const found = await adapter.getReservationForGuest(ctx(), {
      email: 'jane@example.com',
      reservationRef: '999',
    });

    expect(found).toBeNull();
  });

  it('rejects a non-numeric reservationRef without calling the vendor', async () => {
    const { fetch, urls } = stubRest(() => ({ body: {} }));
    const adapter = new GastroplannerAdapter(fetch);

    const found = await adapter.getReservationForGuest(ctx(), {
      email: 'jane@example.com',
      reservationRef: '../venues',
    });

    expect(found).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it('maps 401 responses to a vendor error', async () => {
    const { fetch } = stubRest(() => ({ status: 401, body: {} }));
    const adapter = new GastroplannerAdapter(fetch);

    await expect(adapter.testConnection(ctx())).rejects.toBeInstanceOf(ConnectorVendorError);
  });

  describe('buildStoredConfig', () => {
    const adapter = new GastroplannerAdapter(stubRest(() => ({ body: {} })).fetch);
    const encrypt = (plain: string) => Promise.resolve(`enc(${plain})`);

    it('defaults the base url and encrypts the token', async () => {
      const stored = await adapter.buildStoredConfig({ apiToken: 'partner_token' }, encrypt);
      expect(stored).toEqual({
        baseUrl: 'https://api.gastroplanner.no',
        encryptedApiToken: 'enc(partner_token)',
      });
    });

    it('keeps the previous ciphertext when apiToken is omitted on update', async () => {
      const stored = await adapter.buildStoredConfig({}, encrypt, {
        baseUrl: 'https://api.gastroplanner.no',
        encryptedApiToken: 'ct_old',
      });
      expect(stored.encryptedApiToken).toBe('ct_old');
    });

    it('requires a token when there is no previous config', async () => {
      await expect(adapter.buildStoredConfig({}, encrypt)).rejects.toBeInstanceOf(
        ConnectorVendorError,
      );
    });
  });
});
