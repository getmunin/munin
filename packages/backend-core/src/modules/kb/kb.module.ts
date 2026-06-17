import { Module } from '@nestjs/common';
import { KbService } from './kb.service.ts';
import { KbSearchService } from './kb.search.ts';
import { KbAdminTools } from './kb.tools.ts';
import { EmbeddingProviderHolder } from './embedding.provider.ts';
import { CuratorModule } from '../curator/curator.module.ts';

/**
 * Knowledge Base module: spaces, documents, chunks, versions, search.
 *
 * MCP tool services declared here are picked up by the McpRegistryService
 * via NestJS DiscoveryService at boot — no manual registration needed.
 */
@Module({
  imports: [CuratorModule],
  providers: [EmbeddingProviderHolder, KbService, KbSearchService, KbAdminTools],
  exports: [KbService, KbSearchService],
})
export class KbModule {}
