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
import { createZodDto } from 'nestjs-zod';
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
  type AssetUploadHandle,
  type EntryDto,
  type PreviewLinkDto,
} from '../modules/cms/cms.service.ts';
import type { FieldDef } from '../modules/cms/cms.fields.ts';

export interface CmsDraftDetailDto extends EntryDto {
  fields: FieldDef[];
}

class PatchDraftBody extends createZodDto(
  z.object({
    data: z.record(z.string(), z.unknown()).optional(),
    slug: z.string().min(1).optional(),
    locale: z.string().min(1).optional(),
  }),
) {}

class ScheduleDraftBody extends createZodDto(
  z.object({
    scheduledAt: z.string().min(1),
  }),
) {}

class UploadAssetBody extends createZodDto(
  z.object({
    name: z.string().min(1).max(255),
    mime: z.string().min(1).max(120),
    base64Body: z.string().min(1).max(2_800_000),
    altText: z.string().max(500).optional(),
  }),
) {}

class RequestAssetUploadBody extends createZodDto(
  z.object({
    name: z.string().min(1).max(255),
    mime: z.string().min(1).max(120),
    sizeBytes: z.number().int().positive(),
    altText: z.string().max(500).optional(),
  }),
) {}

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
  async patch(@Param('id') id: string, @Body() input: PatchDraftBody): Promise<CmsDraftDetailDto> {
    const entry = await translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.updateEntry({
        id,
        ifVersion: existing.version,
        data: input.data,
        slug: input.slug,
        locale: input.locale,
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
  async schedule(@Param('id') id: string, @Body() input: ScheduleDraftBody): Promise<EntryDto> {
    return translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.scheduleEntry({
        id,
        ifVersion: existing.version,
        scheduledAt: input.scheduledAt,
      });
    });
  }

  @Post(':id/unschedule')
  @HttpCode(200)
  async unschedule(@Param('id') id: string): Promise<EntryDto> {
    return translate(async () => {
      const existing = await this.cms.getEntry(id);
      return this.cms.unscheduleEntry({ id, ifVersion: existing.version });
    });
  }

  @Post(':id/assets')
  @HttpCode(200)
  async uploadAsset(@Param('id') id: string, @Body() input: UploadAssetBody): Promise<AssetDto> {
    return translate(async () => {
      await this.cms.getEntry(id);
      return this.cms.uploadAssetFromBase64(input);
    });
  }

  @Post(':id/assets/upload-request')
  @HttpCode(200)
  async requestAssetUpload(
    @Param('id') id: string,
    @Body() input: RequestAssetUploadBody,
  ): Promise<AssetUploadHandle> {
    return translate(async () => {
      await this.cms.getEntry(id);
      return this.cms.requestAssetUpload(input);
    });
  }

  @Post(':id/assets/:assetId/complete')
  @HttpCode(200)
  async completeAssetUpload(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
  ): Promise<AssetDto> {
    return translate(async () => {
      await this.cms.getEntry(id);
      return this.cms.completeAssetUpload({ id: assetId });
    });
  }

  @Post(':id/preview-link')
  @HttpCode(200)
  async previewLink(@Param('id') id: string): Promise<PreviewLinkDto> {
    return translate(() => this.cms.createPreviewLink(id));
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
          ? { message: err.message, code: err.code, fieldErrors: err.fieldErrors }
          : { message: err.message, code: err.code },
      );
    }
    if (err instanceof CmsConflictError) {
      throw new ConflictException({ message: err.message, code: err.code });
    }
    throw err;
  }
}
