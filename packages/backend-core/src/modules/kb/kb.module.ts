import { Module } from '@nestjs/common';
import { KbService } from './kb.service.ts';
import { KbSearchService } from './kb.search.ts';
import { KbAdminTools } from './kb.tools.ts';
import { EmbeddingProviderHolder } from './embedding.provider.ts';
import { CuratorModule } from '../curator/curator.module.ts';

@Module({
  imports: [CuratorModule],
  providers: [EmbeddingProviderHolder, KbService, KbSearchService, KbAdminTools],
  exports: [KbService, KbSearchService],
})
export class KbModule {}
