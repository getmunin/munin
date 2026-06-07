import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.ts';
import { AnalyticsAdminTools } from './analytics.tools.ts';
import { GeoIpService } from './geoip.service.ts';

@Module({
  providers: [AnalyticsService, AnalyticsAdminTools, GeoIpService],
  exports: [AnalyticsService, GeoIpService],
})
export class AnalyticsModule {}
