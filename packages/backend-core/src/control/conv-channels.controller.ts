import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { ConvService, type ChannelDto } from '../modules/conv/conv.service.js';
import { WidgetAdminTools } from '../modules/conv/widget/widget.tools.js';
import { EmailAdminTools } from '../modules/conv/email/email.tools.js';
import { EmailChannelConfigInput } from '../modules/conv/email/email.service.js';

const CreateWidgetBody = z.object({
  name: z.string().min(1).max(120),
  displayName: z.string().min(1).max(120),
  originAllowlist: z.array(z.string().url()).default([]),
  webhookOnEscalation: z.string().url().optional(),
});

const UpdateWidgetBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  originAllowlist: z.array(z.string().url()).optional(),
  webhookOnEscalation: z.string().url().nullable().optional(),
});

const SetupEmailBody = z.object({
  channelId: z.string().optional(),
  name: z.string().min(1).max(120),
  config: EmailChannelConfigInput,
});

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
}
