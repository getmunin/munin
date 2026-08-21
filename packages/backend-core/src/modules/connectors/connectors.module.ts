import { Module } from '@nestjs/common';
import { ConnectorRegistry } from './connector.ts';
import { ConnectorsService } from './connectors.service.ts';
import { ConnectorAdminTools } from './connectors.tools.ts';
import { ConnectorCredentialHandler } from './connector-credential.handler.ts';
import { ConnectorOAuthService } from './connector-oauth.service.ts';
import { ConnectorOAuthController } from './connector-oauth.controller.ts';
import { CredentialHandoffModule } from '../credential-handoff/credential-handoff.module.ts';
import { CredentialTargetRegistry } from '../credential-handoff/credential-target.ts';

@Module({
  imports: [CredentialHandoffModule],
  controllers: [ConnectorOAuthController],
  providers: [
    { provide: ConnectorRegistry, useFactory: () => new ConnectorRegistry() },
    ConnectorOAuthService,
    ConnectorsService,
    ConnectorAdminTools,
    ConnectorCredentialHandler,
  ],
  exports: [ConnectorRegistry, ConnectorsService, ConnectorOAuthService],
})
export class ConnectorsModule {
  constructor(registry: CredentialTargetRegistry, handler: ConnectorCredentialHandler) {
    registry.register(handler);
  }
}
