import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import {
  OutreachInvalidError,
  OutreachService,
  type CampaignDto,
} from '../modules/outreach/outreach.service.js';

const CadenceRulesSchema = z.object({
  maxPerWeekPerContact: z.number().int().positive().max(7).optional(),
  quietHoursStart: z.string().regex(/^[0-2]\d:[0-5]\d$/).optional(),
  quietHoursEnd: z.string().regex(/^[0-2]\d:[0-5]\d$/).optional(),
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(50).optional(),
});

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  brief: z.string().min(1).max(5000),
  segmentId: z.string().min(1).max(64),
  channelId: z.string().min(1).max(64),
  cadenceRules: CadenceRulesSchema.optional(),
  ctaUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
  unsubscribeRequired: z.boolean().optional(),
});

const UpdateBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    brief: z.string().min(1).max(5000).optional(),
    segmentId: z.string().min(1).max(64).optional(),
    channelId: z.string().min(1).max(64).optional(),
    cadenceRules: CadenceRulesSchema.optional(),
    ctaUrl: z.string().url().nullable().optional(),
    enabled: z.boolean().optional(),
    unsubscribeRequired: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'patch must contain at least one field' });

interface CampaignListResponse {
  items: CampaignDto[];
}

@Controller('api/outreach/campaigns')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class OutreachCampaignsController {
  constructor(private readonly outreach: OutreachService) {}

  @Get()
  async list(): Promise<CampaignListResponse> {
    const items = await translate(() => this.outreach.listCampaigns());
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<CampaignDto> {
    return translate(() => this.outreach.getCampaign(id));
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<CampaignDto> {
    const parsed = CreateBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() => this.outreach.createCampaign(parsed.data));
  }

  @Post(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: unknown): Promise<CampaignDto> {
    const parsed = UpdateBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() => this.outreach.updateCampaign({ id, patch: parsed.data }));
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
