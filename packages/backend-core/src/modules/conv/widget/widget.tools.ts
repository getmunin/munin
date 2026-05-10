import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { buildApiKey, getCurrentContext, hashSecret, keyPrefix, randomToken } from '@getmunin/core';
import { WidgetChannelConfig } from './widget.types.js';

const CreateInput = z.object({
  name: z.string().min(1).max(120),
  originAllowlist: z.array(z.string().url()).default([]),
  webhookOnEscalation: z.string().url().optional(),
  requireVerifiedIdentity: z.boolean().optional(),
});

const UpdateInput = z.object({
  channelId: z.string(),
  originAllowlist: z.array(z.string().url()).optional(),
  webhookOnEscalation: z.string().url().nullable().optional(),
  requireVerifiedIdentity: z.boolean().optional(),
});

const RotateInput = z.object({ channelId: z.string() });

type WidgetConfig = z.infer<typeof WidgetChannelConfig>;
type SanitizedWidgetConfig = Omit<WidgetConfig, 'identityVerificationSecret'> & {
  /** Whether an identity verification secret is currently configured. The
   *  plaintext is only ever surfaced from `conv_widget_create_channel` and
   *  `conv_widget_rotate_identity_secret`. */
  hasIdentityVerificationSecret: boolean;
};

function sanitizeConfig(config: WidgetConfig): SanitizedWidgetConfig {
  const { identityVerificationSecret, ...rest } = config;
  return { ...rest, hasIdentityVerificationSecret: !!identityVerificationSecret };
}

interface ChannelDto {
  id: string;
  name: string;
  type: 'chat';
  active: boolean;
  config: SanitizedWidgetConfig;
}

interface CreateResult extends ChannelDto {
  widgetKey: string;
  /** HMAC secret for browser-side identity verification. Surfaced once. */
  identityVerificationSecret: string;
}

interface RotateIdentitySecretResult {
  channelId: string;
  identityVerificationSecret: string;
}

@Injectable()
export class WidgetAdminTools {
  @McpTool({
    name: 'conv_widget_create_channel',
    title: 'Create chat-widget channel',
    description:
      'Create a chat-widget channel and mint a widget API key (`mn_widget_*`) bound to it. Returns the plaintext key once; store it server-side and pass it as `Authorization: Bearer` when calling POST /api/v1/widget/messages from the external agent.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async createChannel(args: z.infer<typeof CreateInput>): Promise<CreateResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const identityVerificationSecret = randomToken(32);
    const config = WidgetChannelConfig.parse({
      provider: 'widget',
      originAllowlist: args.originAllowlist,
      webhookOnEscalation: args.webhookOnEscalation,
      identityVerificationSecret,
      requireVerifiedIdentity: args.requireVerifiedIdentity ?? false,
    });

    const [channel] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'chat',
        name: args.name,
        config: config,
      })
      .returning();

    const rawKey = buildApiKey('widget');
    await ctx.db.insert(schema.apiKeys).values({
      orgId: actor.orgId,
      type: 'widget',
      name: `${args.name} widget key`,
      keyHash: hashSecret(rawKey),
      keyPrefix: keyPrefix(rawKey),
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
      widgetKey: rawKey,
      identityVerificationSecret,
    };
  }

  @McpTool({
    name: 'conv_widget_update_channel',
    title: 'Update chat-widget channel',
    description:
      'Update a chat-widget channel\'s originAllowlist / webhookOnEscalation. Pass null to clear webhookOnEscalation. The widget API key is unchanged.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: UpdateInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async updateChannel(args: z.infer<typeof UpdateInput>): Promise<ChannelDto> {
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

    const next = WidgetChannelConfig.parse({
      provider: 'widget',
      originAllowlist: args.originAllowlist ?? prev.originAllowlist,
      webhookOnEscalation:
        args.webhookOnEscalation === null
          ? undefined
          : (args.webhookOnEscalation ?? prev.webhookOnEscalation),
      identityVerificationSecret: prev.identityVerificationSecret,
      requireVerifiedIdentity: args.requireVerifiedIdentity ?? prev.requireVerifiedIdentity,
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

  @McpTool({
    name: 'conv_widget_rotate_key',
    title: 'Rotate widget API key',
    description:
      'Revoke any active widget keys bound to this channel and mint a fresh `mn_widget_*` key. Returns the new plaintext key once. Existing inflight requests using the old key keep working until revocation lands.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RotateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async rotateKey(args: z.infer<typeof RotateInput>): Promise<{ widgetKey: string }> {
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

    const rawKey = buildApiKey('widget');
    await ctx.db.insert(schema.apiKeys).values({
      orgId: actor.orgId,
      type: 'widget',
      name: `${channel[0].name} widget key`,
      keyHash: hashSecret(rawKey),
      keyPrefix: keyPrefix(rawKey),
      scopes: ['conv:widget:write'],
      channelId: args.channelId,
      createdByUserId: actor.userId ?? null,
    });

    return { widgetKey: rawKey };
  }

  @McpTool({
    name: 'conv_widget_rotate_identity_secret',
    title: 'Rotate widget identity-verification secret',
    description:
      'Generate a fresh per-channel HMAC secret used to verify browser-side `data-user-hash` values against `data-external-id`. The previous secret is replaced atomically; any previously-issued user hashes stop verifying immediately and the operator must re-render their pages with newly-computed hashes. Returns the new plaintext once.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RotateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async rotateIdentitySecret(
    args: z.infer<typeof RotateInput>,
  ): Promise<RotateIdentitySecretResult> {
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
