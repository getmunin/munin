import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.ts';
import { AnalyticsAdminTools } from './analytics.tools.ts';
import { GeoIpService } from './geoip.service.ts';
import { ProductEventsService } from './product-events.service.ts';
import { CrmModule } from '../crm/crm.module.ts';
import { ProductEventFieldsService } from './product-event-fields.ts';
import { ProductEventFieldsTools } from './product-event-fields.tools.ts';

@Module({
  imports: [CrmModule],
  providers: [
    AnalyticsService,
    AnalyticsAdminTools,
    GeoIpService,
    ProductEventsService,
    ProductEventFieldsService,
    ProductEventFieldsTools,
  ],
  exports: [AnalyticsService, AnalyticsAdminTools, GeoIpService, ProductEventsService, ProductEventFieldsService],
})
export class AnalyticsModule {}
