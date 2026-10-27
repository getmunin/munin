import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { CrmModule } from '../crm/crm.module.ts';
import { JourneysService } from './journeys.service.ts';
import { JourneysTools } from './journeys.tools.ts';
import { JourneyRuntimeService } from './journey-runtime.service.ts';
import { JourneyRuntimeWorker } from './journey-runtime.worker.ts';
import { JourneyEventSink } from './journey-event.sink.ts';

@Module({
  imports: [CrmModule],
  providers: [JourneysService, JourneysTools, JourneyRuntimeService, JourneyRuntimeWorker, JourneyEventSink],
  exports: [JourneysService, JourneyRuntimeService],
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
