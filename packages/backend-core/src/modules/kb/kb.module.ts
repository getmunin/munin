import { Module } from '@nestjs/common';
import { KbService } from './kb.service.js';
import { KbSearchService } from './kb.search.js';
import { KbAdminTools } from './kb.tools.js';
import { EmbeddingProviderHolder } from './embedding.provider.js';

/**
 * Knowledge Base module: spaces, documents, chunks, versions, search.
 *
 * MCP tool services declared here are picked up by the McpRegistryService
 * via NestJS DiscoveryService at boot — no manual registration needed.
 */
@Module({
  providers: [EmbeddingProviderHolder, KbService, KbSearchService, KbAdminTools],
  exports: [KbService, KbSearchService],
})
export class KbModule {}
