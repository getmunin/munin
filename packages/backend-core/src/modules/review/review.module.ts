import { Module } from '@nestjs/common';
import { KbModule } from '../kb/kb.module.ts';
import { CrmModule } from '../crm/crm.module.ts';
import { OutreachModule } from '../outreach/outreach.module.ts';
import { CmsModule } from '../cms/cms.module.ts';
import { ReviewService } from './review.service.ts';

@Module({
  imports: [KbModule, CrmModule, OutreachModule, CmsModule],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
