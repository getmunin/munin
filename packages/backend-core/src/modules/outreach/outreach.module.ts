import { Module } from '@nestjs/common';
import { ConvModule } from '../conv/conv.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { OutreachService } from './outreach.service.js';
import { OutreachAdminTools } from './outreach.tools.js';

@Module({
  imports: [ConvModule, CrmModule],
  providers: [OutreachService, OutreachAdminTools],
  exports: [OutreachService],
})
export class OutreachModule {}
