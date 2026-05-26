import { Module } from '@nestjs/common';
import { CmsService } from './cms.service.ts';
import { CmsSearchService } from './cms.search.ts';
import { CmsAdminTools } from './cms.tools.ts';
import { CmsScheduleWorker } from './cms.schedule.worker.ts';
import { EmbeddingProviderHolder } from '../kb/embedding.provider.ts';

@Module({
  providers: [
    CmsService,
    CmsSearchService,
    CmsAdminTools,
    CmsScheduleWorker,
    EmbeddingProviderHolder,
  ],
  exports: [CmsService, CmsSearchService, CmsScheduleWorker],
})
export class CmsModule {}
