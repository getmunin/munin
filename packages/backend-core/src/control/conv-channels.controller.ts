import {
  Body,
  Controller,
  Inject,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { ChannelConfigErrorInterceptor } from '../modules/conv/channels/stored-config.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import { ConvService, type ChannelDto } from '../modules/conv/conv.service.ts';
import { WidgetAdminTools } from '../modules/conv/widget/widget.tools.ts';
import { EmailAdminTools } from '../modules/conv/email/email.tools.ts';
import { EmailService } from '../modules/conv/email/email.service.ts';
import {
  SENDING_IDENTITY_PROVIDER,
  type SendingIdentityProvider,
} from '../modules/conv/sending-identities/provider.ts';
import { TwilioSmsAdminService } from '../modules/conv/twilio/twilio-sms-admin.service.ts';
import { MessageBirdSmsAdminService } from '../modules/conv/messagebird/messagebird-sms-admin.service.ts';
import { VapiAdminService } from '../modules/conv/vapi/vapi-admin.service.ts';
import { ThrellAdminService } from '../modules/conv/threll/threll-admin.service.ts';
import { ChannelAdminService } from '../modules/conv/channels/channel-admin.service.ts';
import { ChannelCredentialService } from '../modules/conv/channels/channel-credential.service.ts';
import {
  CreateWidgetBody as CreateWidgetSchema,
  UpdateWidgetBody as UpdateWidgetSchema,
  SetupEmailBody as SetupEmailSchema,
  SendEmailTestBody as SendEmailTestSchema,
  ConfigureTwilioSmsBody as ConfigureTwilioSmsSchema,
  SendTwilioSmsTestBody as SendTwilioSmsTestSchema,
  ConfigureMessageBirdSmsBody as ConfigureMessageBirdSmsSchema,
  SendMessageBirdSmsTestBody as SendMessageBirdSmsTestSchema,
  ConfigureVapiBody as ConfigureVapiSchema,
  VapiCallInitiateBody as VapiCallInitiateSchema,
  ConfigureThrellBody as ConfigureThrellSchema,
  ChannelListOptionsBody as ChannelListOptionsSchema,
  ThrellCallInitiateBody as ThrellCallInitiateSchema,
  ConfigureChannelBody as ConfigureChannelSchema,
  ChannelVoiceCallBody as ChannelVoiceCallSchema,
  ChannelSendTestBody as ChannelSendTestSchema,
} from '@getmunin/types';
import { z } from 'zod';

class ConfigureChannelBody extends createZodDto(ConfigureChannelSchema) {}

class ApplyChannelCredentialsBody extends createZodDto(
  z.object({
    secrets: z.record(z.string(), z.string().min(1)),
  }),
) {}

class ChannelVoiceCallBody extends createZodDto(ChannelVoiceCallSchema) {}

class ChannelSendTestBody extends createZodDto(ChannelSendTestSchema) {}

class CreateWidgetBody extends createZodDto(CreateWidgetSchema) {}

class UpdateWidgetBody extends createZodDto(UpdateWidgetSchema) {}

class SetupEmailBody extends createZodDto(SetupEmailSchema) {}

class SendEmailTestBody extends createZodDto(SendEmailTestSchema) {}

class ConfigureTwilioSmsBody extends createZodDto(ConfigureTwilioSmsSchema) {}

class SendTwilioSmsTestBody extends createZodDto(SendTwilioSmsTestSchema) {}

class ConfigureMessageBirdSmsBody extends createZodDto(ConfigureMessageBirdSmsSchema) {}

class SendMessageBirdSmsTestBody extends createZodDto(SendMessageBirdSmsTestSchema) {}

class ConfigureVapiBody extends createZodDto(ConfigureVapiSchema) {}

class VapiCallInitiateBody extends createZodDto(VapiCallInitiateSchema) {}

class ConfigureThrellBody extends createZodDto(ConfigureThrellSchema) {}

class ChannelListOptionsBody extends createZodDto(ChannelListOptionsSchema) {}

class ThrellCallInitiateBody extends createZodDto(ThrellCallInitiateSchema) {}

interface ChannelListResponse {
  items: ChannelDto[];
}

@Controller('v1/conversations/channels')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor, ChannelConfigErrorInterceptor)
@RequireRole('owner', 'admin')
export class ConvChannelsController {
  constructor(
    private readonly conv: ConvService,
    private readonly widgetTools: WidgetAdminTools,
    private readonly emailTools: EmailAdminTools,
    private readonly email: EmailService,
    private readonly twilioSmsTools: TwilioSmsAdminService,
    private readonly messageBirdSmsTools: MessageBirdSmsAdminService,
    private readonly vapiTools: VapiAdminService,
    private readonly threllTools: ThrellAdminService,
    private readonly channelAdmin: ChannelAdminService,
    private readonly channelCredentials: ChannelCredentialService,
    @Inject(SENDING_IDENTITY_PROVIDER)
    private readonly sendingIdentityProvider: SendingIdentityProvider,
  ) {}

  @Get('email/capabilities')
  emailCapabilities(): { identityOutbound: { available: boolean } } {
    return { identityOutbound: { available: this.sendingIdentityProvider.signsOutbound } };
  }

  @Get('vendors')
  listVendors(): ReturnType<ChannelAdminService['listVendors']> {
    return this.channelAdmin.listVendors();
  }

  @Post()
  @HttpCode(200)
  async configureChannel(@Body() input: ConfigureChannelBody): Promise<Awaited<ReturnType<ChannelAdminService['configure']>>> {
    return this.channelAdmin.configure(input);
  }

  @Post(':id/test')
  @HttpCode(200)
  async testChannel(@Param('id') id: string): Promise<unknown> {
    return this.channelAdmin.test(id);
  }

  @Post(':id/credentials')
  @HttpCode(200)
  applyCredentials(@Param('id') id: string, @Body() input: ApplyChannelCredentialsBody): ReturnType<ChannelCredentialService['apply']> {
    return this.channelCredentials.apply(id, input.secrets);
  }

  @Post(':id/credential-link')
  @HttpCode(200)
  requestCredentialLink(@Param('id') id: string): ReturnType<ChannelCredentialService['requestLink']> {
    return this.channelCredentials.requestLink(id);
  }

  @Post(':id/call')
  @HttpCode(200)
  async callChannel(@Param('id') id: string, @Body() input: ChannelVoiceCallBody): Promise<unknown> {
    return this.channelAdmin.call({ channelId: id, to: input.to, customerName: input.customerName });
  }

  @Post(':id/send-test')
  @HttpCode(200)
  async sendTestChannel(@Param('id') id: string, @Body() input: ChannelSendTestBody): Promise<unknown> {
    return this.channelAdmin.sendTest({ channelId: id, to: input.to, body: input.body });
  }

  @Get()
  async list(): Promise<ChannelListResponse> {
    const items = await this.conv.listChannels();
    return { items };
  }

  @Post('widget')
  @HttpCode(201)
  async createWidget(
    @Body() input: CreateWidgetBody,
  ): Promise<Awaited<ReturnType<WidgetAdminTools['createChannel']>>> {
    return this.widgetTools.createChannel(input);
  }

  @Patch('widget/:id')
  @HttpCode(200)
  async updateWidget(
    @Param('id') id: string,
    @Body() input: UpdateWidgetBody,
  ): Promise<Awaited<ReturnType<WidgetAdminTools['updateChannel']>>> {
    return this.widgetTools.updateChannel({ channelId: id, ...input });
  }

  @Post('widget/:id/rotate-key')
  @HttpCode(200)
  async rotateWidgetKey(@Param('id') id: string): Promise<{ widgetKey: string }> {
    return this.widgetTools.rotateKey({ channelId: id });
  }

  @Post('widget/:id/rotate-identity-secret')
  @HttpCode(200)
  async rotateIdentitySecret(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<WidgetAdminTools['rotateIdentitySecret']>>> {
    return this.widgetTools.rotateIdentitySecret({ channelId: id });
  }

  @Post('email')
  @HttpCode(200)
  async setupEmail(
    @Body() input: SetupEmailBody,
  ): Promise<Awaited<ReturnType<EmailService['configureChannel']>>> {
    return this.email.configureChannel(input);
  }

  @Post('email/:id/test')
  @HttpCode(200)
  async testEmail(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<EmailAdminTools['testChannel']>>> {
    return this.emailTools.testChannel({ channelId: id });
  }

  @Post('email/:id/send-test')
  @HttpCode(200)
  async sendTestEmail(
    @Param('id') id: string,
    @Body() input: SendEmailTestBody,
  ): Promise<Awaited<ReturnType<EmailAdminTools['sendTest']>>> {
    return this.emailTools.sendTest({ channelId: id, to: input.to });
  }

  @Post('twilio-sms')
  @HttpCode(200)
  async configureTwilioSms(
    @Body() input: ConfigureTwilioSmsBody,
  ): Promise<Awaited<ReturnType<TwilioSmsAdminService['configure']>>> {
    return this.twilioSmsTools.configure(input);
  }

  @Post('twilio-sms/:id/test')
  @HttpCode(200)
  async testTwilioSms(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<TwilioSmsAdminService['testChannel']>>> {
    return this.twilioSmsTools.testChannel({ channelId: id });
  }

  @Post('twilio-sms/:id/send-test')
  @HttpCode(200)
  async sendTwilioSmsTest(
    @Param('id') id: string,
    @Body() input: SendTwilioSmsTestBody,
  ): Promise<Awaited<ReturnType<TwilioSmsAdminService['sendTest']>>> {
    return this.twilioSmsTools.sendTest({
      channelId: id,
      to: input.to,
      body: input.body,
    });
  }

  @Post('messagebird-sms')
  @HttpCode(200)
  async configureMessageBirdSms(
    @Body() input: ConfigureMessageBirdSmsBody,
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminService['configure']>>> {
    return this.messageBirdSmsTools.configure(input);
  }

  @Post('messagebird-sms/:id/test')
  @HttpCode(200)
  async testMessageBirdSms(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminService['testChannel']>>> {
    return this.messageBirdSmsTools.testChannel({ channelId: id });
  }

  @Post('messagebird-sms/:id/send-test')
  @HttpCode(200)
  async sendMessageBirdSmsTest(
    @Param('id') id: string,
    @Body() input: SendMessageBirdSmsTestBody,
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminService['sendTest']>>> {
    return this.messageBirdSmsTools.sendTest({
      channelId: id,
      to: input.to,
      body: input.body,
    });
  }

  @Post('vapi')
  @HttpCode(200)
  async configureVapi(
    @Body() input: ConfigureVapiBody,
  ): Promise<Awaited<ReturnType<VapiAdminService['configure']>>> {
    return this.vapiTools.configure(input);
  }

  @Post('vapi/:id/test')
  @HttpCode(200)
  async testVapi(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<VapiAdminService['testChannel']>>> {
    return this.vapiTools.testChannel({ channelId: id });
  }

  @Post('vapi/:id/call')
  @HttpCode(200)
  async vapiCall(
    @Param('id') id: string,
    @Body() input: VapiCallInitiateBody,
  ): Promise<Awaited<ReturnType<VapiAdminService['callInitiate']>>> {
    return this.vapiTools.callInitiate({
      channelId: id,
      to: input.to,
      customerName: input.customerName,
    });
  }

  @Post('threll')
  @HttpCode(200)
  async configureThrell(
    @Body() input: ConfigureThrellBody,
  ): Promise<Awaited<ReturnType<ThrellAdminService['configure']>>> {
    return this.threllTools.configure(input);
  }

  @Post('options')
  @HttpCode(200)
  async listChannelOptions(
    @Body() input: ChannelListOptionsBody,
  ): Promise<Awaited<ReturnType<ChannelAdminService['listOptions']>>> {
    return this.channelAdmin.listOptions({ vendor: input.vendor, config: input.config });
  }

  @Post(':id/options')
  @HttpCode(200)
  async listChannelOptionsForChannel(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<ChannelAdminService['listOptions']>>> {
    return this.channelAdmin.listOptions({ channelId: id });
  }

  @Post('threll/:id/test')
  @HttpCode(200)
  async testThrell(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<ThrellAdminService['testChannel']>>> {
    return this.threllTools.testChannel({ channelId: id });
  }

  @Post('threll/:id/call')
  @HttpCode(200)
  async threllCall(
    @Param('id') id: string,
    @Body() input: ThrellCallInitiateBody,
  ): Promise<Awaited<ReturnType<ThrellAdminService['callInitiate']>>> {
    return this.threllTools.callInitiate({
      channelId: id,
      to: input.to,
      customerName: input.customerName,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id') id: string): Promise<void> {
    await this.channelAdmin.onArchive(id);
    await this.conv.archiveChannel(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Param('id') id: string): Promise<ChannelDto> {
    return this.conv.setChannelActive(id, true);
  }
}
