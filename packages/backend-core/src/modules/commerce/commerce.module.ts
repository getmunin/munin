import { Module } from '@nestjs/common';
import { ConnectorRegistry } from '../connectors/connector.ts';
import { ConnectorsModule } from '../connectors/connectors.module.ts';
import { CommerceService } from './commerce.service.ts';
import { CommerceAdminTools } from './commerce.tools.ts';
import { CommerceSelfServiceTools } from './commerce.self-service.tools.ts';
import { ShopifyAdapter } from './shopify.adapter.ts';
import { MagentoAdapter } from './magento.adapter.ts';

@Module({
  imports: [ConnectorsModule],
  providers: [CommerceService, CommerceAdminTools, CommerceSelfServiceTools],
  exports: [CommerceService],
})
export class CommerceModule {
  constructor(registry: ConnectorRegistry) {
    registry.register(new ShopifyAdapter());
    registry.register(new MagentoAdapter());
  }
}
