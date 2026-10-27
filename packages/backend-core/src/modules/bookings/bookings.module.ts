import { Module } from '@nestjs/common';
import { ConnectorRegistry } from '../connectors/connector.ts';
import { ConnectorsModule } from '../connectors/connectors.module.ts';
import { AnalyticsModule } from '../analytics/analytics.module.ts';
import { BookingEventsService } from './booking-events.service.ts';
import { BookingsService } from './bookings.service.ts';
import { BookingAdminTools } from './bookings.tools.ts';
import { BookingSelfServiceTools } from './bookings.self-service.tools.ts';
import { GastroplannerAdapter } from './gastroplanner.adapter.ts';

@Module({
  imports: [ConnectorsModule, AnalyticsModule],
  providers: [BookingsService, BookingEventsService, BookingAdminTools, BookingSelfServiceTools],
  exports: [BookingsService],
})
export class BookingsModule {
  constructor(registry: ConnectorRegistry) {
    registry.register(new GastroplannerAdapter());
  }
}
