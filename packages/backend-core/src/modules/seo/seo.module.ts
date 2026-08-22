import { Module } from '@nestjs/common';
import { ConnectorRegistry } from '../connectors/connector.ts';
import { ConnectorsModule } from '../connectors/connectors.module.ts';
import { SeoService } from './seo.service.ts';
import { SeoAdminTools } from './seo.tools.ts';
import { BingAdapter } from './bing.adapter.ts';
import { GoogleSearchConsoleAdapter } from './google-search-console.adapter.ts';

@Module({
  imports: [ConnectorsModule],
  providers: [SeoService, SeoAdminTools],
  exports: [SeoService],
})
export class SeoModule {
  constructor(registry: ConnectorRegistry) {
    registry.register(new BingAdapter());
    registry.register(new GoogleSearchConsoleAdapter());
  }
}
