import { Module } from '@nestjs/common';
import { CuratorModule } from '../curator/curator.module.js';
import { McpModule } from '../../mcp/mcp.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { ConvService } from './conv.service.js';
import { ConversationClaimsService } from './conv.claims.service.js';
import { ConvAdminTools } from './conv.tools.js';
import { ConvSelfServiceTools } from './conv.self-service.tools.js';
import { EmailService } from './email/email.service.js';
import { EmailAdminTools } from './email/email.tools.js';
import { EmailAdapter } from './email/email-adapter.js';
import { CHANNEL_ADAPTERS } from './channels/adapter.js';
import { ChannelIngestService } from './channels/channel-ingest.service.js';
import { ChannelWebhookController } from './channels/channel-webhook.controller.js';
import { InboundPollWorker } from './channels/inbound-poll.worker.js';
import { OutboundDeliveryWorker } from './channels/outbound-delivery.worker.js';
import { MessageBirdClientService } from './messagebird/messagebird-client.service.js';
import { MessageBirdSmsAdapter } from './messagebird/messagebird-sms-adapter.js';
import { MessageBirdSmsAdminTools } from './messagebird/messagebird-sms.tools.js';
import { MessageBirdSmsService } from './messagebird/messagebird-sms.service.js';
import { VapiClientService } from './vapi/vapi-client.service.js';
import { VapiAdapter } from './vapi/vapi-adapter.js';
import { VapiAdminTools } from './vapi/vapi.tools.js';
import { VapiService } from './vapi/vapi.service.js';
import { VapiToolBridge } from './vapi/vapi-tool-bridge.js';
import { VoiceCallbackService } from './voice-callback.service.js';
import { VoiceCallbackTools } from './voice-callback.tools.js';
import { TwilioClientService } from './twilio/twilio-client.service.js';
import { TwilioSmsAdapter } from './twilio/twilio-sms-adapter.js';
import { TwilioSmsAdminTools } from './twilio/twilio-sms.tools.js';
import { TwilioSmsService } from './twilio/twilio-sms.service.js';
import { WidgetAdapter } from './widget/widget-adapter.js';
import { WidgetIngestService } from './widget/widget-ingest.service.js';
import { WidgetVoiceService } from './widget/widget-voice.service.js';
import { WidgetController } from './widget/widget.controller.js';
import { WidgetEmailFallbackWorker } from './widget/widget-email-fallback.worker.js';
import { WidgetAdminTools } from './widget/widget.tools.js';

@Module({
  imports: [CuratorModule, McpModule, RealtimeModule],
  controllers: [WidgetController, ChannelWebhookController],
  providers: [
    ConvService,
    ConversationClaimsService,
    ConvAdminTools,
    ConvSelfServiceTools,
    EmailService,
    EmailAdminTools,
    EmailAdapter,
    ChannelIngestService,
    InboundPollWorker,
    OutboundDeliveryWorker,
    MessageBirdClientService,
    MessageBirdSmsService,
    MessageBirdSmsAdapter,
    MessageBirdSmsAdminTools,
    TwilioClientService,
    TwilioSmsService,
    TwilioSmsAdapter,
    TwilioSmsAdminTools,
    VapiClientService,
    VapiService,
    VapiAdapter,
    VapiAdminTools,
    VapiToolBridge,
    VoiceCallbackService,
    VoiceCallbackTools,
    WidgetAdapter,
    WidgetEmailFallbackWorker,
    WidgetIngestService,
    WidgetVoiceService,
    WidgetAdminTools,
    {
      provide: CHANNEL_ADAPTERS,
      useFactory: (
        email: EmailAdapter,
        twilioSms: TwilioSmsAdapter,
        messageBirdSms: MessageBirdSmsAdapter,
        vapi: VapiAdapter,
        widget: WidgetAdapter,
      ) => [email, twilioSms, messageBirdSms, vapi, widget],
      inject: [EmailAdapter, TwilioSmsAdapter, MessageBirdSmsAdapter, VapiAdapter, WidgetAdapter],
    },
  ],
  exports: [
    ConvService,
    ConversationClaimsService,
    EmailService,
    EmailAdapter,
    EmailAdminTools,
    MessageBirdClientService,
    MessageBirdSmsService,
    MessageBirdSmsAdapter,
    MessageBirdSmsAdminTools,
    TwilioClientService,
    TwilioSmsService,
    TwilioSmsAdapter,
    TwilioSmsAdminTools,
    VapiClientService,
    VapiService,
    VapiAdapter,
    VapiAdminTools,
    VoiceCallbackService,
    VoiceCallbackTools,
    WidgetAdapter,
    WidgetAdminTools,
    WidgetEmailFallbackWorker,
    ChannelIngestService,
    InboundPollWorker,
    OutboundDeliveryWorker,
    CHANNEL_ADAPTERS,
  ],
})
export class ConvModule {}
