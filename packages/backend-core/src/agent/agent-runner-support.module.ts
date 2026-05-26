import { Module } from '@nestjs/common';
import { ConvModule } from '../modules/conv/conv.module.js';
import { CuratorModule } from '../modules/curator/curator.module.js';
import { DbModule } from '../common/db/db.module.js';
import { InProcessMuninRestClientFactoryService } from './in-process-rest-client.js';

@Module({
  imports: [DbModule, ConvModule, CuratorModule],
  providers: [InProcessMuninRestClientFactoryService],
  exports: [InProcessMuninRestClientFactoryService],
})
export class AgentRunnerSupportModule {}
