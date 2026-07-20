import { Module } from '@nestjs/common';
import { ConnectorRegistry } from './connector.ts';
import { ConnectorsService } from './connectors.service.ts';
import { ConnectorAdminTools } from './connectors.tools.ts';

/**
 * Domain-agnostic connector trunk: encrypted connection storage, the
 * connectors_* admin CRUD tools, and the vendor registry. Domain modules
 * (commerce, bookings) import this module and register their adapters into
 * the registry — the trunk never imports a vendor.
 */
@Module({
  providers: [
    { provide: ConnectorRegistry, useFactory: () => new ConnectorRegistry() },
    ConnectorsService,
    ConnectorAdminTools,
  ],
  exports: [ConnectorRegistry, ConnectorsService],
})
export class ConnectorsModule {}
