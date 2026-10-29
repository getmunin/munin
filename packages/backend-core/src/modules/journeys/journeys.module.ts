import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { CrmModule } from '../crm/crm.module.ts';
import { OutreachModule } from '../outreach/outreach.module.ts';
import { CuratorModule } from '../curator/curator.module.ts';
import { JourneysService } from './journeys.service.ts';
import { JourneysTools } from './journeys.tools.ts';
import { JourneyRuntimeService } from './journey-runtime.service.ts';
import { JourneyRuntimeWorker } from './journey-runtime.worker.ts';
import { JourneyEventSink } from './journey-event.sink.ts';
import { JourneySimulator } from './journey-simulator.ts';
import { JourneyPublishingService } from './journey-publishing.service.ts';

@Module({
  imports: [CrmModule, OutreachModule, CuratorModule],
  providers: [
    JourneysService,
    JourneysTools,
    JourneyRuntimeService,
    JourneyRuntimeWorker,
    JourneyEventSink,
    JourneySimulator,
    JourneyPublishingService,
  ],
  exports: [JourneysService, JourneyRuntimeService, JourneyPublishingService],
})
export class JourneysModule implements OnModuleInit {
  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(JourneyEventSink) private readonly sink: JourneyEventSink,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerSink(this.sink);
  }
}
