import { Module } from '@nestjs/common';
import { ConvModule } from '../modules/conv/conv.module.ts';
import { CuratorModule } from '../modules/curator/curator.module.ts';
import { DbModule } from '../common/db/db.module.ts';
import { InProcessMuninRestClientFactoryService } from './in-process-rest-client.ts';

@Module({
  imports: [DbModule, ConvModule, CuratorModule],
  providers: [InProcessMuninRestClientFactoryService],
  exports: [InProcessMuninRestClientFactoryService],
})
export class AgentRunnerSupportModule {}
