import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { open as openMaxmind, type CountryResponse, type Reader } from 'maxmind';

/**
 * Resolves a client IP to its ISO 3166-1 alpha-2 country code via a local
 * MaxMind-format `.mmdb` (the official `GeoLite2-Country.mmdb` or any
 * DB-IP-Lite compatible file).
 *
 * The reader memory-maps the file once at boot, so lookups are O(µs) and
 * involve no network calls. If `MUNIN_GEOIP_DB_PATH` is unset or the file
 * fails to open, the service quietly no-ops: `lookupCountry()` returns
 * `null` for every IP, and the rest of the pipeline still records the
 * event (just without a country column).
 *
 * IP is consumed only here and is never persisted. Only the 2-character
 * country code lands on the row.
 */
@Injectable()
export class GeoIpService implements OnModuleInit {
  private readonly logger = new Logger(GeoIpService.name);
  private reader: Reader<CountryResponse> | null = null;

  async onModuleInit(): Promise<void> {
    const path = process.env.MUNIN_GEOIP_DB_PATH?.trim();
    if (!path) {
      this.logger.log('geoip.disabled: MUNIN_GEOIP_DB_PATH not set');
      return;
    }
    try {
      this.reader = await openMaxmind<CountryResponse>(path);
      this.logger.log(`geoip.enabled: db=${path}`);
    } catch (err) {
      // Don't crash the app — country resolution is best-effort.
      this.logger.warn(`geoip.disabled: failed to open ${path}: ${(err as Error).message}`);
      this.reader = null;
    }
  }

  /**
   * Returns an uppercase ISO 3166-1 alpha-2 code, or `null` for: no
   * configured DB, missing/private/unknown IP, or a record without a
   * country.
   */
  lookupCountry(ip: string | undefined): string | null {
    if (!this.reader || !ip) return null;
    // Strip IPv4-mapped IPv6 prefix ("::ffff:1.2.3.4" → "1.2.3.4") so the
    // mmdb reader matches against the IPv4 tree. Private/link-local ranges
    // simply miss in the DB and return null below.
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    try {
      const record = this.reader.get(normalized);
      const code = record?.country?.iso_code ?? record?.registered_country?.iso_code;
      if (!code) return null;
      // mmdb always returns 2-char ISO codes, but defend against malformed DBs.
      return code.length === 2 ? code.toUpperCase() : null;
    } catch {
      return null;
    }
  }
}
