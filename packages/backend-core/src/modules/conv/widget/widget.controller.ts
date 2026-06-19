import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { WidgetThrottlerGuard } from './widget-throttler.guard.ts';
import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../../../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../../../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../../../common/audit/audit.interceptor.ts';
import {
  WidgetIdentifyInput,
  WidgetIngestInput,
  WidgetVoiceAvailableQuery,
  WidgetVoiceEventInput,
  WidgetVoiceStartInput,
  WidgetListConversationsQuery,
  WidgetListMessagesQuery,
  WidgetSetVisitorInput,
  WidgetStartConversationInput,
} from './widget.types.ts';
import type {
  WidgetIdentifyResult,
  WidgetIngestInputT,
  WidgetIngestResult,
  WidgetListConversationsResult,
  WidgetListMessagesResult,
  WidgetSetVisitorResult,
  WidgetStartConversationResult,
  WidgetVoiceAvailabilityResult,
  WidgetVoiceEventResult,
  WidgetVoiceStartResult,
} from './widget.types.ts';
import { WidgetIngestService } from './widget-ingest.service.ts';
import { WidgetVoiceService } from './widget-voice.service.ts';

@Controller('v1/widget')
@UseGuards(AuthGuard, WidgetThrottlerGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class WidgetController {
  constructor(
    @Inject(WidgetIngestService) private readonly ingestService: WidgetIngestService,
    @Inject(WidgetVoiceService) private readonly voiceService: WidgetVoiceService,
  ) {}

  @Post('messages')
  async ingest(
    @Body() rawBody: unknown,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetIngestResult> {
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
    return this.ingestService.ingest(orgId, input, { origin });
  }

  @Get('messages')
  async list(
    @Query() rawQuery: Record<string, string>,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetListMessagesResult> {
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

    const parsed = WidgetListMessagesQuery.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_query: ${parsed.error.message}`);
    }
    const query = parsed.data;
    if (query.channelId !== key.channelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.ingestService.listMessages(orgId, query, { origin });
  }

  @Get('conversations')
  async listConversations(
    @Query() rawQuery: Record<string, string>,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetListConversationsResult> {
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

    const parsed = WidgetListConversationsQuery.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_query: ${parsed.error.message}`);
    }
    const query = parsed.data;
    if (query.channelId !== key.channelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.ingestService.listConversations(orgId, query, { origin });
  }

  @Patch('visitor')
  async setVisitor(
    @Body() rawBody: unknown,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetSetVisitorResult> {
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

    const parsed = WidgetSetVisitorInput.safeParse(rawBody);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_input: ${parsed.error.message}`);
    }
    const input = parsed.data;
    if (input.channelId !== key.channelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.ingestService.setVisitor(orgId, input, { origin });
  }

  @Post('identify')
  async identify(
    @Body() rawBody: unknown,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetIdentifyResult> {
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

    const parsed = WidgetIdentifyInput.safeParse(rawBody);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_input: ${parsed.error.message}`);
    }
    const input = parsed.data;
    if (input.channelId !== key.channelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.ingestService.identify(orgId, input, { origin });
  }

  @Post('conversations')
  async startConversation(
    @Body() rawBody: unknown,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetStartConversationResult> {
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

    const parsed = WidgetStartConversationInput.safeParse(rawBody);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_input: ${parsed.error.message}`);
    }
    const input = parsed.data;
    if (input.channelId !== key.channelId) {
      throw new ForbiddenException('widget_channel_mismatch');
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.ingestService.startConversation(orgId, input, { origin });
  }

  @Get('voice/available')
  async voiceAvailable(
    @Query() rawQuery: Record<string, string>,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetVoiceAvailabilityResult> {
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

    const parsed = WidgetVoiceAvailableQuery.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_voice_available: ${parsed.error.message}`);
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.voiceService.checkAvailability(orgId, key.channelId, parsed.data, { origin });
  }

  @Post('voice/start')
  async startVoice(
    @Body() rawBody: unknown,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetVoiceStartResult> {
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

    const parsed = WidgetVoiceStartInput.safeParse(rawBody);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_voice_start: ${parsed.error.message}`);
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.voiceService.startSession(orgId, key.channelId, parsed.data, { origin });
  }

  @Post('voice/event')
  async voiceEvent(
    @Body() rawBody: unknown,
    @Headers('origin') origin: string | undefined,
  ): Promise<WidgetVoiceEventResult> {
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

    const parsed = WidgetVoiceEventInput.safeParse(rawBody);
    if (!parsed.success) {
      throw new ForbiddenException(`invalid_widget_voice_event: ${parsed.error.message}`);
    }

    const orgId = key.orgId ?? actor.orgId;
    return this.voiceService.recordEvent(orgId, key.channelId, parsed.data, { origin });
  }
}
