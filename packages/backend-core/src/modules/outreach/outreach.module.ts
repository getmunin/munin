import { Module } from '@nestjs/common';
import { ConvModule } from '../conv/conv.module.ts';
import { CrmModule } from '../crm/crm.module.ts';
import { OutreachService } from './outreach.service.ts';
import { OutreachAdminTools } from './outreach.tools.ts';

@Module({
  imports: [ConvModule, CrmModule],
  providers: [OutreachService, OutreachAdminTools],
  exports: [OutreachService],
})
export class OutreachModule {}
