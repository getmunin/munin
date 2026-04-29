import { Module } from '@nestjs/common';
import { CmsService } from './cms.service.js';
import { CmsSearchService } from './cms.search.js';
import { CmsAdminTools } from './cms.tools.js';
import { CmsScheduleWorker } from './cms.schedule.worker.js';
import { EmbeddingProviderHolder } from '../kb/embedding.provider.js';

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
