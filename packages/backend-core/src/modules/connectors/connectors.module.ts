import { Module } from '@nestjs/common';
import { ConnectorRegistry } from './connector.ts';
import { ConnectorsService } from './connectors.service.ts';
import { ConnectorAdminTools } from './connectors.tools.ts';
import { ConnectorCredentialHandler } from './connector-credential.handler.ts';
import { CustomMcpAdapter } from './custom-mcp.adapter.ts';
import { ConnectorOAuthService } from './connector-oauth.service.ts';
import { ConnectorOAuthController } from './connector-oauth.controller.ts';
import { CredentialHandoffModule } from '../credential-handoff/credential-handoff.module.ts';
import { CredentialTargetRegistry } from '../credential-handoff/credential-target.ts';
import { OutboundOAuthModule } from '../../common/outbound-oauth/outbound-oauth.module.ts';

@Module({
  imports: [CredentialHandoffModule, OutboundOAuthModule],
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
  constructor(registry: CredentialTargetRegistry, handler: ConnectorCredentialHandler, connectors: ConnectorRegistry) {
    registry.register(handler);
    connectors.register(new CustomMcpAdapter());
  }
}
