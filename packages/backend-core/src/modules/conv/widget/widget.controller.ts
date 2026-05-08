import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../../../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../../../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../../../common/audit/audit.interceptor.js';
import { WidgetIngestInput } from './widget.types.js';
import type { WidgetIngestInputT, WidgetIngestResult } from './widget.types.js';
import { WidgetIngestService } from './widget-ingest.service.js';

/**
 * Public ingest endpoint for chat-widget channels. Authenticated by a
 * channel-bound widget API key (`mn_widget_*`); the AuthGuard resolves the
 * key to an `actor` whose `id` is the api_keys row id, which carries the
 * `channel_id` binding. Body's `channelId` must match — defense-in-depth
 * against a key being used against an unrelated channel.
 *
 * The endpoint runs inside the standard tenancy transaction (org_id GUC
 * set), then briefly flips bypass_rls inside `WidgetIngestService.ingest`
 * to write across conv_contacts / conv_conversations / conv_messages for
 * the bound org.
 */
@Controller('api/v1/widget')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class WidgetController {
  constructor(@Inject(WidgetIngestService) private readonly ingestService: WidgetIngestService) {}

  @Post('messages')
  async ingest(@Body() rawBody: unknown): Promise<WidgetIngestResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor;
    if (!actor) throw new ForbiddenException('widget_auth_required');

    const keyRow = await ctx.db
      .select({ channelId: schema.apiKeys.channelId, orgId: schema.apiKeys.orgId })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, actor.id))
      .limit(1);
    const key = keyRow[0];
    if (!key || !key.channelId) {
      throw new ForbiddenException('widget_key_required');
    }

    const parsed = WidgetIngestInput.safeParse(rawBody);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_input: ${parsed.error.message}`);
    }
    const input: WidgetIngestInputT = parsed.data;
    if (input.channelId !== key.channelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.ingestService.ingest(orgId, input);
  }
}
