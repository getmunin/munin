import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { open as openMaxmind, type CountryResponse, type Reader } from 'maxmind';

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
      this.logger.warn(`geoip.disabled: failed to open ${path}: ${(err as Error).message}`);
      this.reader = null;
    }
  }

  lookupCountry(ip: string | undefined): string | null {
    if (!this.reader || !ip) return null;
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    try {
      const record = this.reader.get(normalized);
      const code = record?.country?.iso_code ?? record?.registered_country?.iso_code;
      if (!code) return null;
      return code.length === 2 ? code.toUpperCase() : null;
    } catch {
      return null;
    }
  }
}
