import { Global, Module } from '@nestjs/common';
import { WebhookDispatcher } from '@munin/core';
import { WebhookWorker } from './webhook.worker.js';

@Global()
@Module({
  providers: [
    {
      provide: WebhookDispatcher,
      useFactory: () => new WebhookDispatcher(),
    },
    WebhookWorker,
  ],
  exports: [WebhookDispatcher, WebhookWorker],
})
export class WebhookModule {}
