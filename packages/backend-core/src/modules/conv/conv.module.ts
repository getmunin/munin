import { Module } from '@nestjs/common';
import { CuratorModule } from '../curator/curator.module.js';
import { ConvService } from './conv.service.js';
import { ConversationClaimsService } from './conv.claims.service.js';
import { ConvAdminTools } from './conv.tools.js';
import { ConvSelfServiceTools } from './conv.self-service.tools.js';
import { EmailService } from './email/email.service.js';
import { EmailAdminTools } from './email/email.tools.js';
import { EmailAdapter } from './email/email-adapter.js';
import { CHANNEL_ADAPTERS } from './channels/adapter.js';
import { InboundPollWorker } from './channels/inbound-poll.worker.js';
import { OutboundDeliveryWorker } from './channels/outbound-delivery.worker.js';
import { WidgetAdapter } from './widget/widget-adapter.js';
import { WidgetIngestService } from './widget/widget-ingest.service.js';
import { WidgetController } from './widget/widget.controller.js';
import { WidgetAdminTools } from './widget/widget.tools.js';

@Module({
  imports: [CuratorModule],
  controllers: [WidgetController],
  providers: [
    ConvService,
    ConversationClaimsService,
    ConvAdminTools,
    ConvSelfServiceTools,
    EmailService,
    EmailAdminTools,
    EmailAdapter,
    InboundPollWorker,
    OutboundDeliveryWorker,
    WidgetAdapter,
    WidgetIngestService,
    WidgetAdminTools,
    {
      provide: CHANNEL_ADAPTERS,
      useFactory: (email: EmailAdapter, widget: WidgetAdapter) => [email, widget],
      inject: [EmailAdapter, WidgetAdapter],
    },
  ],
  exports: [
    ConvService,
    ConversationClaimsService,
    EmailService,
    EmailAdapter,
    WidgetAdapter,
    InboundPollWorker,
    OutboundDeliveryWorker,
    CHANNEL_ADAPTERS,
  ],
})
export class ConvModule {}
