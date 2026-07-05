import { Module } from '@nestjs/common';
import { ConnectorRegistry } from './connector.ts';
import { ConnectorsService } from './connectors.service.ts';
import { ConnectorAdminTools } from './connectors.tools.ts';
import { ShopifyAdapter } from './commerce/shopify.adapter.ts';
import { MagentoAdapter } from './commerce/magento.adapter.ts';
import { CommerceService } from './commerce/commerce.service.ts';
import { CommerceAdminTools } from './commerce/commerce.tools.ts';
import { CommerceSelfServiceTools } from './commerce/commerce.self-service.tools.ts';
import { GastroplannerAdapter } from './bookings/gastroplanner.adapter.ts';
import { BookingsService } from './bookings/bookings.service.ts';
import { BookingAdminTools } from './bookings/bookings.tools.ts';
import { BookingSelfServiceTools } from './bookings/bookings.self-service.tools.ts';

@Module({
  providers: [
    {
      provide: ConnectorRegistry,
      useFactory: () =>
        new ConnectorRegistry([
          new ShopifyAdapter(),
          new MagentoAdapter(),
          new GastroplannerAdapter(),
        ]),
    },
    ConnectorsService,
    ConnectorAdminTools,
    CommerceService,
    CommerceAdminTools,
    CommerceSelfServiceTools,
    BookingsService,
    BookingAdminTools,
    BookingSelfServiceTools,
  ],
  exports: [ConnectorsService, CommerceService, BookingsService],
})
export class ConnectorsModule {}
