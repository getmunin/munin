import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { ConvModule } from '../conv/conv.module.ts';
import { SlackApiClient } from './slack-api.client.ts';
import { SlackService } from './slack.service.ts';
import { SlackEventSink } from './slack-event-sink.ts';
import { SlackBridgeWorker } from './slack-bridge.worker.ts';
import { SlackInboundService } from './slack-inbound.service.ts';
import { SlackInteractionsService } from './slack-interactions.service.ts';
import { SlackUserMappingService } from './slack-user-mapping.service.ts';
import { SlackAdminTools } from './slack.tools.ts';
import { SlackOAuthController } from './slack-oauth.controller.ts';
import { SlackEventsController } from './slack-events.controller.ts';

@Module({
  imports: [ConvModule],
  providers: [
    SlackApiClient,
    SlackService,
    SlackEventSink,
    SlackBridgeWorker,
    SlackInboundService,
    SlackInteractionsService,
    SlackUserMappingService,
    SlackAdminTools,
  ],
  controllers: [SlackOAuthController, SlackEventsController],
  exports: [SlackService],
})
export class SlackModule implements OnModuleInit {
  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(SlackEventSink) private readonly sink: SlackEventSink,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerSink(this.sink);
  }
}
