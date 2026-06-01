import {
  Body,
  Controller,
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
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import { ConvService, type ChannelDto } from '../modules/conv/conv.service.ts';
import { WidgetAdminTools } from '../modules/conv/widget/widget.tools.ts';
import { EmailAdminTools } from '../modules/conv/email/email.tools.ts';
import { TwilioSmsAdminTools } from '../modules/conv/twilio/twilio-sms.tools.ts';
import { MessageBirdSmsAdminTools } from '../modules/conv/messagebird/messagebird-sms.tools.ts';
import { VapiAdminTools } from '../modules/conv/vapi/vapi.tools.ts';
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
} from '@getmunin/types';

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

interface ChannelListResponse {
  items: ChannelDto[];
}

@Controller('v1/conversations/channels')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class ConvChannelsController {
  constructor(
    private readonly conv: ConvService,
    private readonly widgetTools: WidgetAdminTools,
    private readonly emailTools: EmailAdminTools,
    private readonly twilioSmsTools: TwilioSmsAdminTools,
    private readonly messageBirdSmsTools: MessageBirdSmsAdminTools,
    private readonly vapiTools: VapiAdminTools,
  ) {}

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
  ): Promise<Awaited<ReturnType<EmailAdminTools['setupChannel']>>> {
    return this.emailTools.setupChannel(input);
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
  ): Promise<Awaited<ReturnType<TwilioSmsAdminTools['configure']>>> {
    return this.twilioSmsTools.configure(input);
  }

  @Post('twilio-sms/:id/test')
  @HttpCode(200)
  async testTwilioSms(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<TwilioSmsAdminTools['testChannel']>>> {
    return this.twilioSmsTools.testChannel({ channelId: id });
  }

  @Post('twilio-sms/:id/send-test')
  @HttpCode(200)
  async sendTwilioSmsTest(
    @Param('id') id: string,
    @Body() input: SendTwilioSmsTestBody,
  ): Promise<Awaited<ReturnType<TwilioSmsAdminTools['sendTest']>>> {
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
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminTools['configure']>>> {
    return this.messageBirdSmsTools.configure(input);
  }

  @Post('messagebird-sms/:id/test')
  @HttpCode(200)
  async testMessageBirdSms(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminTools['testChannel']>>> {
    return this.messageBirdSmsTools.testChannel({ channelId: id });
  }

  @Post('messagebird-sms/:id/send-test')
  @HttpCode(200)
  async sendMessageBirdSmsTest(
    @Param('id') id: string,
    @Body() input: SendMessageBirdSmsTestBody,
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminTools['sendTest']>>> {
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
  ): Promise<Awaited<ReturnType<VapiAdminTools['configure']>>> {
    return this.vapiTools.configure(input);
  }

  @Post('vapi/:id/test')
  @HttpCode(200)
  async testVapi(
    @Param('id') id: string,
  ): Promise<Awaited<ReturnType<VapiAdminTools['testChannel']>>> {
    return this.vapiTools.testChannel({ channelId: id });
  }

  @Post('vapi/:id/call')
  @HttpCode(200)
  async vapiCall(
    @Param('id') id: string,
    @Body() input: VapiCallInitiateBody,
  ): Promise<Awaited<ReturnType<VapiAdminTools['callInitiate']>>> {
    return this.vapiTools.callInitiate({
      channelId: id,
      to: input.to,
      customerName: input.customerName,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id') id: string): Promise<void> {
    await this.conv.archiveChannel(id);
  }
}
