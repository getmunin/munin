import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { ConvModule } from '../conv/conv.module.ts';
import { CrmModule } from '../crm/crm.module.ts';
import { CuratorModule } from '../curator/curator.module.ts';
import { OutreachService } from './outreach.service.ts';
import { OutreachAdminTools } from './outreach.tools.ts';
import { OutreachSendWorker } from './outreach.send.worker.ts';
import { OutreachOutcomeSink } from './outreach-outcome.sink.ts';

@Module({
  imports: [ConvModule, CrmModule, CuratorModule],
  providers: [
    OutreachService,
    OutreachAdminTools,
    OutreachSendWorker,
    OutreachOutcomeSink,
  ],
  exports: [OutreachService],
})
export class OutreachModule implements OnModuleInit {
  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(OutreachOutcomeSink) private readonly sink: OutreachOutcomeSink,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerSink(this.sink);
  }
}
