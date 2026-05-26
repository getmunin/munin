import {
  BadRequestException,
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
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { ConvService, type ChannelDto } from '../modules/conv/conv.service.ts';
import { WidgetAdminTools } from '../modules/conv/widget/widget.tools.ts';
import { EmailAdminTools } from '../modules/conv/email/email.tools.ts';
import { TwilioSmsAdminTools } from '../modules/conv/twilio/twilio-sms.tools.ts';
import { MessageBirdSmsAdminTools } from '../modules/conv/messagebird/messagebird-sms.tools.ts';
import { VapiAdminTools } from '../modules/conv/vapi/vapi.tools.ts';
import {
  CreateWidgetBody,
  UpdateWidgetBody,
  SetupEmailBody,
  SendEmailTestBody,
  ConfigureTwilioSmsBody,
  SendTwilioSmsTestBody,
  ConfigureMessageBirdSmsBody,
  SendMessageBirdSmsTestBody,
  ConfigureVapiBody,
  VapiCallInitiateBody,
} from '@getmunin/types';

interface ChannelListResponse {
  items: ChannelDto[];
}

@Controller('v1/conversations/channels')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
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
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<WidgetAdminTools['createChannel']>>> {
    const parsed = CreateWidgetBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.widgetTools.createChannel(parsed.data);
  }

  @Patch('widget/:id')
  @HttpCode(200)
  async updateWidget(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<WidgetAdminTools['updateChannel']>>> {
    const parsed = UpdateWidgetBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.widgetTools.updateChannel({ channelId: id, ...parsed.data });
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
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<EmailAdminTools['setupChannel']>>> {
    const parsed = SetupEmailBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.emailTools.setupChannel(parsed.data);
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
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<EmailAdminTools['sendTest']>>> {
    const parsed = SendEmailTestBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.emailTools.sendTest({ channelId: id, to: parsed.data.to });
  }

  @Post('twilio-sms')
  @HttpCode(200)
  async configureTwilioSms(
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<TwilioSmsAdminTools['configure']>>> {
    const parsed = ConfigureTwilioSmsBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.twilioSmsTools.configure(parsed.data);
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
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<TwilioSmsAdminTools['sendTest']>>> {
    const parsed = SendTwilioSmsTestBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.twilioSmsTools.sendTest({
      channelId: id,
      to: parsed.data.to,
      body: parsed.data.body,
    });
  }

  @Post('messagebird-sms')
  @HttpCode(200)
  async configureMessageBirdSms(
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminTools['configure']>>> {
    const parsed = ConfigureMessageBirdSmsBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.messageBirdSmsTools.configure(parsed.data);
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
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<MessageBirdSmsAdminTools['sendTest']>>> {
    const parsed = SendMessageBirdSmsTestBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.messageBirdSmsTools.sendTest({
      channelId: id,
      to: parsed.data.to,
      body: parsed.data.body,
    });
  }

  @Post('vapi')
  @HttpCode(200)
  async configureVapi(
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<VapiAdminTools['configure']>>> {
    const parsed = ConfigureVapiBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.vapiTools.configure(parsed.data);
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
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<VapiAdminTools['callInitiate']>>> {
    const parsed = VapiCallInitiateBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.vapiTools.callInitiate({
      channelId: id,
      to: parsed.data.to,
      customerName: parsed.data.customerName,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id') id: string): Promise<void> {
    await this.conv.archiveChannel(id);
  }
}
