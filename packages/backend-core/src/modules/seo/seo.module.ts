import { Module } from '@nestjs/common';
import { ConnectorRegistry } from '../connectors/connector.ts';
import { ConnectorsModule } from '../connectors/connectors.module.ts';
import { SeoService } from './seo.service.ts';
import { SeoAdminTools } from './seo.tools.ts';
import { SeoResearchService } from './seo-research.service.ts';
import { SeoResearchTools } from './seo-research.tools.ts';
import { BingAdapter } from './bing.adapter.ts';
import { GoogleSearchConsoleAdapter } from './google-search-console.adapter.ts';
import { DataForSeoAdapter } from './dataforseo.adapter.ts';

@Module({
  imports: [ConnectorsModule],
  providers: [SeoService, SeoAdminTools, SeoResearchService, SeoResearchTools],
  exports: [SeoService, SeoResearchService],
})
export class SeoModule {
  constructor(registry: ConnectorRegistry) {
    registry.register(new BingAdapter());
    registry.register(new GoogleSearchConsoleAdapter());
    registry.register(new DataForSeoAdapter());
  }
}
