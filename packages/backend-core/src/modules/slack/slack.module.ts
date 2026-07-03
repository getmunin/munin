import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { SlackApiClient } from './slack-api.client.ts';
import { SlackService } from './slack.service.ts';
import { SlackEventSink } from './slack-event-sink.ts';
import { SlackBridgeWorker } from './slack-bridge.worker.ts';
import { SlackAdminTools } from './slack.tools.ts';
import { SlackOAuthController } from './slack-oauth.controller.ts';

@Module({
  providers: [SlackApiClient, SlackService, SlackEventSink, SlackBridgeWorker, SlackAdminTools],
  controllers: [SlackOAuthController],
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
