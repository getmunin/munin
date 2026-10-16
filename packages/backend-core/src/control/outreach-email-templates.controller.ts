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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { OutreachInvalidError } from '../modules/outreach/outreach.service.ts';
import { EMAIL_CONTENT_FORMATS } from '../modules/outreach/email-template-render.ts';
import {
  OutreachEmailTemplatesService,
  type EmailTemplateDto,
  type EmailTemplatePreviewDto,
  type EmailTemplateSummaryDto,
} from '../modules/outreach/outreach-email-templates.service.ts';

const Mjml = z.string().min(1).max(200_000);

class CreateTemplateBody extends createZodDto(
  z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullable().optional(),
    mjml: Mjml,
    isDefault: z.boolean().optional(),
  }),
) {}

class UpdateTemplateBody extends createZodDto(
  z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    mjml: Mjml.optional(),
    isDefault: z.boolean().optional(),
  }),
) {}

class PreviewTemplateBody extends createZodDto(
  z.object({
    templateId: z.string().min(1).max(64).optional(),
    mjml: Mjml.optional(),
    content: z.object({
      format: z.enum(EMAIL_CONTENT_FORMATS),
      body: z.string().min(1).max(100_000),
    }),
    name: z.string().max(200).nullable().optional(),
    subject: z.string().max(500).nullable().optional(),
    preheader: z.string().max(500).nullable().optional(),
  }),
) {}

interface TemplateListResponse {
  items: EmailTemplateSummaryDto[];
}

@Controller('v1/outreach/email-templates')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OutreachEmailTemplatesController {
  constructor(private readonly templates: OutreachEmailTemplatesService) {}

  @Get()
  async list(): Promise<TemplateListResponse> {
    return { items: await this.templates.listTemplates() };
  }

  @Post('preview')
  @HttpCode(200)
  async preview(@Body() input: PreviewTemplateBody): Promise<EmailTemplatePreviewDto> {
    return translate(() => this.templates.previewTemplate(input));
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<EmailTemplateDto> {
    return translate(() => this.templates.getTemplate(id));
  }

  @Post()
  async create(@Body() input: CreateTemplateBody): Promise<EmailTemplateDto> {
    return translate(() => this.templates.createTemplate(input));
  }

  @Patch(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() input: UpdateTemplateBody): Promise<EmailTemplateDto> {
    return translate(() => this.templates.updateTemplate({ id, ...input }));
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string): Promise<{ deleted: true; id: string }> {
    return translate(() => this.templates.deleteTemplate(id));
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OutreachInvalidError) throw new BadRequestException(err.message);
    throw err;
  }
}
