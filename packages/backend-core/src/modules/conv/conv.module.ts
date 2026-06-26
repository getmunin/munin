import { Module } from '@nestjs/common';
import { CuratorModule } from '../curator/curator.module.ts';
import { McpModule } from '../../mcp/mcp.module.ts';
import { RealtimeModule } from '../../realtime/realtime.module.ts';
import { PublicThrottleModule } from '../../common/rate-limit/public-throttle.module.ts';
import { ConvService } from './conv.service.ts';
import { ConvSchedulerService } from './conv-scheduler.service.ts';
import { ConversationClaimsService } from './conv.claims.service.ts';
import { ConvAdminTools } from './conv.tools.ts';
import { ConvSelfServiceTools } from './conv.self-service.tools.ts';
import { EmailService } from './email/email.service.ts';
import { EmailAdminTools } from './email/email.tools.ts';
import { EmailAdapter } from './email/email-adapter.ts';
import { CHANNEL_ADAPTERS } from './channels/adapter.ts';
import {
  CHANNEL_ADMIN_PROVIDERS,
  type ChannelAdminProvider,
} from './channels/channel-admin.ts';
import { ChannelAdminService } from './channels/channel-admin.service.ts';
import { ChannelAdminTools } from './channels/channel-admin.tools.ts';
import { VapiAdminProvider } from './vapi/vapi-admin.provider.ts';
import { ThrellAdminProvider } from './threll/threll-admin.provider.ts';
import { TwilioSmsAdminProvider } from './twilio/twilio-sms-admin.provider.ts';
import { MessageBirdSmsAdminProvider } from './messagebird/messagebird-sms-admin.provider.ts';
import { ChannelIngestService } from './channels/channel-ingest.service.ts';
import { ChannelWebhookController } from './channels/channel-webhook.controller.ts';
import { InboundPollWorker } from './channels/inbound-poll.worker.ts';
import { OutboundDeliveryWorker } from './channels/outbound-delivery.worker.ts';
import { MessageBirdClientService } from './messagebird/messagebird-client.service.ts';
import { MessageBirdSmsAdapter } from './messagebird/messagebird-sms-adapter.ts';
import { MessageBirdSmsAdminTools } from './messagebird/messagebird-sms.tools.ts';
import { MessageBirdSmsService } from './messagebird/messagebird-sms.service.ts';
import { VapiClientService } from './vapi/vapi-client.service.ts';
import { VapiAdapter } from './vapi/vapi-adapter.ts';
import { VapiAdminTools } from './vapi/vapi.tools.ts';
import { VapiService } from './vapi/vapi.service.ts';
import { VapiToolBridge } from './vapi/vapi-tool-bridge.ts';
import { ThrellClientService } from './threll/threll-client.service.ts';
import { ThrellAdapter } from './threll/threll-adapter.ts';
import { ThrellAdminTools } from './threll/threll.tools.ts';
import { ThrellService } from './threll/threll.service.ts';
import { ThrellToolBridge } from './threll/threll-tool-bridge.ts';
import { VoiceCallbackService } from './voice-callback.service.ts';
import { VoiceCallbackTools } from './voice-callback.tools.ts';
import { TwilioClientService } from './twilio/twilio-client.service.ts';
import { TwilioSmsAdapter } from './twilio/twilio-sms-adapter.ts';
import { TwilioSmsAdminTools } from './twilio/twilio-sms.tools.ts';
import { TwilioSmsService } from './twilio/twilio-sms.service.ts';
import { WidgetAdapter } from './widget/widget-adapter.ts';
import { WidgetIngestService } from './widget/widget-ingest.service.ts';
import { WidgetVoiceService } from './widget/widget-voice.service.ts';
import { WidgetController } from './widget/widget.controller.ts';
import { WidgetEmailFallbackWorker } from './widget/widget-email-fallback.worker.ts';
import { WidgetAdminTools } from './widget/widget.tools.ts';
import { WidgetThrottlerGuard } from './widget/widget-throttler.guard.ts';

@Module({
  imports: [CuratorModule, McpModule, RealtimeModule, PublicThrottleModule],
  controllers: [WidgetController, ChannelWebhookController],
  providers: [
    ConvService,
    ConvSchedulerService,
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
    ThrellClientService,
    ThrellService,
    ThrellAdapter,
    ThrellAdminTools,
    ThrellToolBridge,
    VoiceCallbackService,
    VoiceCallbackTools,
    WidgetAdapter,
    WidgetEmailFallbackWorker,
    WidgetIngestService,
    WidgetVoiceService,
    WidgetAdminTools,
    WidgetThrottlerGuard,
    {
      provide: CHANNEL_ADAPTERS,
      useFactory: (
        email: EmailAdapter,
        twilioSms: TwilioSmsAdapter,
        messageBirdSms: MessageBirdSmsAdapter,
        vapi: VapiAdapter,
        threll: ThrellAdapter,
        widget: WidgetAdapter,
      ) => [email, twilioSms, messageBirdSms, vapi, threll, widget],
      inject: [
        EmailAdapter,
        TwilioSmsAdapter,
        MessageBirdSmsAdapter,
        VapiAdapter,
        ThrellAdapter,
        WidgetAdapter,
      ],
    },
    VapiAdminProvider,
    ThrellAdminProvider,
    TwilioSmsAdminProvider,
    MessageBirdSmsAdminProvider,
    ChannelAdminService,
    ChannelAdminTools,
    {
      provide: CHANNEL_ADMIN_PROVIDERS,
      useFactory: (
        vapi: VapiAdminProvider,
        threll: ThrellAdminProvider,
        twilioSms: TwilioSmsAdminProvider,
        messageBirdSms: MessageBirdSmsAdminProvider,
      ): ChannelAdminProvider[] => [vapi, threll, twilioSms, messageBirdSms],
      inject: [
        VapiAdminProvider,
        ThrellAdminProvider,
        TwilioSmsAdminProvider,
        MessageBirdSmsAdminProvider,
      ],
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
    ThrellClientService,
    ThrellService,
    ThrellAdapter,
    ThrellAdminTools,
    ChannelAdminService,
    ChannelAdminTools,
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
