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
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { ConvService, type ChannelDto } from '../modules/conv/conv.service.js';
import { WidgetAdminTools } from '../modules/conv/widget/widget.tools.js';
import { EmailAdminTools } from '../modules/conv/email/email.tools.js';
import {
  CreateWidgetBody,
  UpdateWidgetBody,
  SetupEmailBody,
  SendEmailTestBody,
} from '@getmunin/types';

interface ChannelListResponse {
  items: ChannelDto[];
}

@Controller('api/v1/conversations/channels')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class ConvChannelsController {
  constructor(
    private readonly conv: ConvService,
    private readonly widgetTools: WidgetAdminTools,
    private readonly emailTools: EmailAdminTools,
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

  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id') id: string): Promise<void> {
    await this.conv.archiveChannel(id);
  }
}
