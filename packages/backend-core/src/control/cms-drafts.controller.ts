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
  type AssetDto,
  type EntryDto,
} from '../modules/cms/cms.service.ts';
import type { FieldDef } from '../modules/cms/cms.fields.ts';

export interface CmsDraftDetailDto extends EntryDto {
  fields: FieldDef[];
}

const PatchBody = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  slug: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
});

const ScheduleBody = z.object({
  scheduledAt: z.string().min(1),
});

const AssetUploadBody = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  base64Body: z.string().min(1).max(2_800_000),
  altText: z.string().max(500).optional(),
});

@Controller('v1/cms/drafts')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CmsDraftsController {
  constructor(private readonly cms: CmsService) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<CmsDraftDetailDto> {
    const entry = await translate(() => this.cms.getEntry(id));
    return this.attachFields(entry);
  }

  @Patch(':id')
  @HttpCode(200)
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<CmsDraftDetailDto> {
    const parsed = PatchBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const entry = await translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.updateEntry({
        id,
        ifVersion: existing.version,
        data: parsed.data.data,
        slug: parsed.data.slug,
        locale: parsed.data.locale,
      });
    });
    return this.attachFields(entry);
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

  @Post(':id/assets')
  @HttpCode(200)
  async uploadAsset(@Param('id') id: string, @Body() body: unknown): Promise<AssetDto> {
    const parsed = AssetUploadBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(async () => {
      await this.cms.getEntry(id);
      return this.cms.uploadAssetFromBase64(parsed.data);
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

  private async attachFields(entry: EntryDto): Promise<CmsDraftDetailDto> {
    const collection = await this.cms.getCollection(entry.collectionId);
    return { ...entry, fields: collection.fields };
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CmsInvalidError) {
      throw new BadRequestException(
        err.fieldErrors && err.fieldErrors.length > 0
          ? { message: err.message, fieldErrors: err.fieldErrors }
          : err.message,
      );
    }
    if (err instanceof CmsConflictError) throw new ConflictException(err.message);
    throw err;
  }
}
