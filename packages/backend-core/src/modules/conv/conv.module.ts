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
import { ChannelCredentialService } from './channels/channel-credential.service.ts';
import { ChannelCredentialTools } from './channels/channel-credential.tools.ts';
import { CredentialHandoffModule } from '../credential-handoff/credential-handoff.module.ts';
import { CredentialTargetRegistry } from '../credential-handoff/credential-target.ts';
import { VapiAdminProvider } from './vapi/vapi-admin.provider.ts';
import { ThrellAdminProvider } from './threll/threll-admin.provider.ts';
import { TwilioSmsAdminProvider } from './twilio/twilio-sms-admin.provider.ts';
import { MessageBirdSmsAdminProvider } from './messagebird/messagebird-sms-admin.provider.ts';
import { ChannelIngestService } from './channels/channel-ingest.service.ts';
import { ChannelWebhookController } from './channels/channel-webhook.controller.ts';
import { InboundPollWorker } from './channels/inbound-poll.worker.ts';
import { OutboundDeliveryWorker } from './channels/outbound-delivery.worker.ts';
import { SnoozeWakeWorker } from './snooze-wake.worker.ts';
import { MessageBirdClientService } from './messagebird/messagebird-client.service.ts';
import { MessageBirdSmsAdapter } from './messagebird/messagebird-sms-adapter.ts';
import { MessageBirdSmsAdminService } from './messagebird/messagebird-sms-admin.service.ts';
import { MessageBirdSmsService } from './messagebird/messagebird-sms.service.ts';
import { VapiClientService } from './vapi/vapi-client.service.ts';
import { VapiAdapter } from './vapi/vapi-adapter.ts';
import { VapiAdminService } from './vapi/vapi-admin.service.ts';
import { VapiService } from './vapi/vapi.service.ts';
import { VapiToolBridge } from './vapi/vapi-tool-bridge.ts';
import { ThrellClientService } from './threll/threll-client.service.ts';
import { ThrellAdapter } from './threll/threll-adapter.ts';
import { ThrellAdminService } from './threll/threll-admin.service.ts';
import { ThrellService } from './threll/threll.service.ts';
import { ThrellToolBridge } from './threll/threll-tool-bridge.ts';
import { VoiceCallbackService } from './voice-callback.service.ts';
import { VoiceCallbackTools } from './voice-callback.tools.ts';
import { TwilioClientService } from './twilio/twilio-client.service.ts';
import { TwilioSmsAdapter } from './twilio/twilio-sms-adapter.ts';
import { TwilioSmsAdminService } from './twilio/twilio-sms-admin.service.ts';
import { TwilioSmsService } from './twilio/twilio-sms.service.ts';
import { WidgetAdapter } from './widget/widget-adapter.ts';
import { WidgetIngestService } from './widget/widget-ingest.service.ts';
import { WidgetVoiceService } from './widget/widget-voice.service.ts';
import { WidgetController } from './widget/widget.controller.ts';
import { WidgetEmailFallbackWorker } from './widget/widget-email-fallback.worker.ts';
import { WidgetChannelAdminService } from './widget/widget-channel-admin.service.ts';
import { WidgetAdminTools } from './widget/widget.tools.ts';
import { WidgetThrottlerGuard } from './widget/widget-throttler.guard.ts';

@Module({
  imports: [CuratorModule, McpModule, RealtimeModule, PublicThrottleModule, CredentialHandoffModule],
  controllers: [WidgetController, ChannelWebhookController],
  providers: [
    ConvService,
    ConvSchedulerService,
    ConversationClaimsService,
    ConvAdminTools,
    ConvSelfServiceTools,
    EmailService,
    EmailAdminTools,
    ChannelCredentialService,
    ChannelCredentialTools,
    EmailAdapter,
    ChannelIngestService,
    InboundPollWorker,
    OutboundDeliveryWorker,
    SnoozeWakeWorker,
    MessageBirdClientService,
    MessageBirdSmsService,
    MessageBirdSmsAdapter,
    MessageBirdSmsAdminService,
    TwilioClientService,
    TwilioSmsService,
    TwilioSmsAdapter,
    TwilioSmsAdminService,
    VapiClientService,
    VapiService,
    VapiAdapter,
    VapiAdminService,
    VapiToolBridge,
    ThrellClientService,
    ThrellService,
    ThrellAdapter,
    ThrellAdminService,
    ThrellToolBridge,
    VoiceCallbackService,
    VoiceCallbackTools,
    WidgetAdapter,
    WidgetEmailFallbackWorker,
    WidgetIngestService,
    WidgetVoiceService,
    WidgetChannelAdminService,
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
    MessageBirdSmsAdminService,
    TwilioClientService,
    TwilioSmsService,
    TwilioSmsAdapter,
    TwilioSmsAdminService,
    VapiClientService,
    VapiService,
    VapiAdapter,
    VapiAdminService,
    ThrellClientService,
    ThrellService,
    ThrellAdapter,
    ThrellAdminService,
    ChannelAdminService,
    ChannelAdminTools,
    ChannelCredentialService,
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
export class ConvModule {
  constructor(registry: CredentialTargetRegistry, handler: ChannelCredentialService) {
    registry.register(handler);
  }
}
