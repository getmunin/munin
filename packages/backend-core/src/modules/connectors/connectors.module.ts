import { Module } from '@nestjs/common';
import { ConnectorRegistry } from './connector.ts';
import { ConnectorsService } from './connectors.service.ts';
import { ConnectorAdminTools } from './connectors.tools.ts';
import { ConnectorCredentialHandler } from './connector-credential.handler.ts';
import { CredentialHandoffModule } from '../credential-handoff/credential-handoff.module.ts';
import { CredentialTargetRegistry } from '../credential-handoff/credential-target.ts';

/**
 * Domain-agnostic connector trunk: encrypted connection storage, the
 * connectors_* admin CRUD tools, and the vendor registry. Domain modules
 * (commerce, bookings) import this module and register their adapters into
 * the registry — the trunk never imports a vendor.
 */
@Module({
  imports: [CredentialHandoffModule],
  providers: [
    { provide: ConnectorRegistry, useFactory: () => new ConnectorRegistry() },
    ConnectorsService,
    ConnectorAdminTools,
    ConnectorCredentialHandler,
  ],
  exports: [ConnectorRegistry, ConnectorsService],
})
export class ConnectorsModule {
  constructor(registry: CredentialTargetRegistry, handler: ConnectorCredentialHandler) {
    registry.register(handler);
  }
}
