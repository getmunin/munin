import { Module } from '@nestjs/common';
import { ConvModule } from '../conv/conv.module.ts';
import { CrmModule } from '../crm/crm.module.ts';
import { OutreachService } from './outreach.service.ts';
import { OutreachAdminTools } from './outreach.tools.ts';
import { OutreachSendWorker } from './outreach.send.worker.ts';

@Module({
  imports: [ConvModule, CrmModule],
  providers: [OutreachService, OutreachAdminTools, OutreachSendWorker],
  exports: [OutreachService],
})
export class OutreachModule {}
