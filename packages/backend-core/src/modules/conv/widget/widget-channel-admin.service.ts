import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getCurrentContext, randomToken } from '@getmunin/core';
import { mintApiKey } from '../../../common/api-keys/api-key.helpers.ts';
import { assertOriginAllowlistPopulated } from '../../../common/allowlist.ts';
import { WIDGET_VOICE_VENDORS, WidgetChannelConfig } from './widget.types.ts';

type WidgetConfig = z.infer<typeof WidgetChannelConfig>;

export type SanitizedWidgetConfig = Omit<WidgetConfig, 'identityVerificationSecret'> & {
  hasIdentityVerificationSecret: boolean;
};

export interface WidgetChannelDto {
  id: string;
  name: string;
  type: 'chat';
  active: boolean;
  config: SanitizedWidgetConfig;
}

export interface CreateWidgetChannelResult extends WidgetChannelDto {
  widgetKey: string;
  identityVerificationSecret: string;
}

export interface RotateWidgetIdentitySecretResult {
  channelId: string;
  identityVerificationSecret: string;
}

export interface CreateWidgetChannelInput {
  name: string;
  originAllowlist: string[];
  webhookOnEscalation?: string;
  requireVerifiedIdentity?: boolean;
  voiceChannelId?: string;
}

export interface UpdateWidgetChannelInput {
  channelId: string;
  originAllowlist?: string[];
  webhookOnEscalation?: string | null;
  requireVerifiedIdentity?: boolean;
  voiceChannelId?: string | null;
}

function assertAllowlistPopulated(originAllowlist: readonly string[]): void {
  assertOriginAllowlistPopulated({
    origins: originAllowlist,
    envVar: 'MUNIN_WIDGET_REQUIRE_ALLOWLIST',
    errorCode: 'origin_allowlist_required',
    field: 'originAllowlist',
    defaultRequire: true,
  });
}

async function assertVoiceChannelLinkable(orgId: string, voiceChannelId: string): Promise<void> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.convChannels.id })
    .from(schema.convChannels)
    .where(
      and(
        eq(schema.convChannels.id, voiceChannelId),
        eq(schema.convChannels.orgId, orgId),
        eq(schema.convChannels.type, 'voice'),
        inArray(schema.convChannels.vendor, [...WIDGET_VOICE_VENDORS]),
        isNull(schema.convChannels.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new BadRequestException({
      message: `conv_widget_voice_channel_invalid: ${voiceChannelId} is not a Vapi or Threll voice channel in this organization`,
      code: 'conv_widget_voice_channel_invalid',
    });
  }
}

function sanitizeConfig(config: WidgetConfig): SanitizedWidgetConfig {
  const { identityVerificationSecret, ...rest } = config;
  return { ...rest, hasIdentityVerificationSecret: !!identityVerificationSecret };
}

@Injectable()
export class WidgetChannelAdminService {
  async createChannel(args: CreateWidgetChannelInput): Promise<CreateWidgetChannelResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    assertAllowlistPopulated(args.originAllowlist);
    if (args.voiceChannelId) {
      await assertVoiceChannelLinkable(actor.orgId, args.voiceChannelId);
    }

    const identityVerificationSecret = randomToken(32);
    const config = WidgetChannelConfig.parse({
      provider: 'widget',
      originAllowlist: args.originAllowlist,
      webhookOnEscalation: args.webhookOnEscalation,
      identityVerificationSecret,
      requireVerifiedIdentity: args.requireVerifiedIdentity ?? false,
      voiceChannelId: args.voiceChannelId,
    });

    const [channel] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'chat',
        vendor: 'munin',
        name: args.name,
        config: config,
      })
      .returning();

    const key = await mintApiKey(ctx.db, {
      orgId: actor.orgId,
      type: 'widget',
      name: `${args.name} widget key`,
      scopes: ['conv:widget:write'],
      channelId: channel!.id,
      createdByUserId: actor.userId ?? null,
    });

    return {
      id: channel!.id,
      name: channel!.name,
      type: 'chat',
      active: channel!.active,
      config: sanitizeConfig(config),
      widgetKey: key.rawKey,
      identityVerificationSecret,
    };
  }

  async updateChannel(args: UpdateWidgetChannelInput): Promise<WidgetChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, args.channelId),
          eq(schema.convChannels.orgId, actor.orgId),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundException(`channel ${args.channelId} not found`);
    const prev = WidgetChannelConfig.parse(existing.config);

    if (args.originAllowlist !== undefined) {
      assertAllowlistPopulated(args.originAllowlist);
    }
    if (args.voiceChannelId) {
      await assertVoiceChannelLinkable(actor.orgId, args.voiceChannelId);
    }

    const next = WidgetChannelConfig.parse({
      ...prev,
      originAllowlist: args.originAllowlist ?? prev.originAllowlist,
      webhookOnEscalation:
        args.webhookOnEscalation === null
          ? undefined
          : (args.webhookOnEscalation ?? prev.webhookOnEscalation),
      requireVerifiedIdentity: args.requireVerifiedIdentity ?? prev.requireVerifiedIdentity,
      voiceChannelId:
        args.voiceChannelId === null ? undefined : (args.voiceChannelId ?? prev.voiceChannelId),
    });

    const [updated] = await ctx.db
      .update(schema.convChannels)
      .set({ config: next, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, args.channelId))
      .returning();

    return {
      id: updated!.id,
      name: updated!.name,
      type: 'chat',
      active: updated!.active,
      config: sanitizeConfig(next),
    };
  }

  async rotateKey(args: { channelId: string }): Promise<{ widgetKey: string }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const channel = await ctx.db
      .select({ id: schema.convChannels.id, name: schema.convChannels.name })
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, args.channelId),
          eq(schema.convChannels.orgId, actor.orgId),
        ),
      )
      .limit(1);
    if (!channel[0]) throw new NotFoundException(`channel ${args.channelId} not found`);

    await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.channelId, args.channelId),
          eq(schema.apiKeys.type, 'widget'),
        ),
      );

    const key = await mintApiKey(ctx.db, {
      orgId: actor.orgId,
      type: 'widget',
      name: `${channel[0].name} widget key`,
      scopes: ['conv:widget:write'],
      channelId: args.channelId,
      createdByUserId: actor.userId ?? null,
    });

    return { widgetKey: key.rawKey };
  }

  async rotateIdentitySecret(args: {
    channelId: string;
  }): Promise<RotateWidgetIdentitySecretResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, args.channelId),
          eq(schema.convChannels.orgId, actor.orgId),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundException(`channel ${args.channelId} not found`);
    const prev = WidgetChannelConfig.parse(existing.config);

    const identityVerificationSecret = randomToken(32);
    const next = WidgetChannelConfig.parse({
      ...prev,
      identityVerificationSecret,
    });

    await ctx.db
      .update(schema.convChannels)
      .set({ config: next, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, args.channelId));

    return { channelId: args.channelId, identityVerificationSecret };
  }
}
