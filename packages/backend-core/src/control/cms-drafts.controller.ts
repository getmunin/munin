import {
  BadRequestException,
  Body,
  ConflictException,
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
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  CmsConflictError,
  CmsInvalidError,
  CmsService,
  type EntryDto,
} from '../modules/cms/cms.service.ts';

const PatchBody = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  slug: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
});

const ScheduleBody = z.object({
  scheduledAt: z.string().min(1),
});

@Controller('v1/cms-drafts')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CmsDraftsController {
  constructor(private readonly cms: CmsService) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<EntryDto> {
    return translate(() => this.cms.getEntry(id));
  }

  @Patch(':id')
  @HttpCode(200)
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<EntryDto> {
    const parsed = PatchBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.updateEntry({
        id,
        ifVersion: existing.version,
        data: parsed.data.data,
        slug: parsed.data.slug,
        locale: parsed.data.locale,
      });
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string): Promise<EntryDto> {
    return translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.publishEntry({ id, ifVersion: existing.version });
    });
  }

  @Post(':id/schedule')
  @HttpCode(200)
  async schedule(@Param('id') id: string, @Body() body: unknown): Promise<EntryDto> {
    const parsed = ScheduleBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.scheduleEntry({
        id,
        ifVersion: existing.version,
        scheduledAt: parsed.data.scheduledAt,
      });
    });
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@Param('id') id: string): Promise<{ dismissed: true }> {
    await translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.archiveEntry({ id, ifVersion: existing.version });
    });
    return { dismissed: true };
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CmsInvalidError) throw new BadRequestException(err.message);
    if (err instanceof CmsConflictError) throw new ConflictException(err.message);
    throw err;
  }
}
