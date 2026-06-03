import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service.ts';
import { WebhookAdminTools } from './webhooks.tools.ts';

@Module({
  providers: [WebhooksService, WebhookAdminTools],
  exports: [WebhooksService],
})
export class WebhooksModule {}
