import {
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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { SOCIAL_LINK_PLACEMENTS } from '../modules/social/social-platform.ts';
import { SocialService, type SocialDraftDto } from '../modules/social/social.service.ts';

class ReviseBody extends createZodDto(z.object({ body: z.string().min(1) })) {}

class LinkPlacementBody extends createZodDto(
  z.object({
    linkPlacement: z.enum(SOCIAL_LINK_PLACEMENTS),
    linkCommentText: z.string().max(1000).nullable().optional(),
  }),
) {}

class MarkPostedBody extends createZodDto(
  z.object({ permalink: z.string().url().nullable().optional() }),
) {}

class DismissBody extends createZodDto(
  z.object({ reason: z.string().max(500).nullable().optional() }),
) {}

@Controller('v1/social/drafts')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class SocialDraftsController {
  constructor(private readonly social: SocialService) {}

  @Get(':id')
  get(@Param('id') id: string): Promise<SocialDraftDto> {
    return this.social.getDraft(id);
  }

  @Patch(':id')
  @HttpCode(200)
  revise(@Param('id') id: string, @Body() body: ReviseBody): Promise<SocialDraftDto> {
    return this.social.reviseDraft(id, body.body);
  }

  @Patch(':id/link-placement')
  @HttpCode(200)
  setLinkPlacement(
    @Param('id') id: string,
    @Body() body: LinkPlacementBody,
  ): Promise<SocialDraftDto> {
    return this.social.setDraftLinkPlacement(id, {
      linkPlacement: body.linkPlacement,
      linkCommentText: body.linkCommentText ?? null,
    });
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id') id: string): Promise<SocialDraftDto> {
    return this.social.publishDraft(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @Body() body: MarkPostedBody): Promise<SocialDraftDto> {
    return this.social.markPosted(id, body.permalink ?? null);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(
    @Param('id') id: string,
    @Body() body: DismissBody,
  ): Promise<{ dismissed: true; id: string }> {
    return this.social.dismissDraft(id, body.reason ?? null);
  }
}
