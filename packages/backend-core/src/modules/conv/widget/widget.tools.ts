import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { buildApiKey, getCurrentContext, hashSecret, keyPrefix } from '@getmunin/core';
import { WidgetChannelConfig } from './widget.types.js';

const CreateInput = z.object({
  name: z.string().min(1).max(120),
  displayName: z.string().min(1).max(120),
  originAllowlist: z.array(z.string().url()).default([]),
  webhookOnEscalation: z.string().url().optional(),
});

const UpdateInput = z.object({
  channelId: z.string(),
  displayName: z.string().min(1).max(120).optional(),
  originAllowlist: z.array(z.string().url()).optional(),
  webhookOnEscalation: z.string().url().nullable().optional(),
});

const RotateInput = z.object({ channelId: z.string() });

interface ChannelDto {
  id: string;
  name: string;
  type: 'chat';
  active: boolean;
  config: z.infer<typeof WidgetChannelConfig>;
}

interface CreateResult extends ChannelDto {
  widgetKey: string;
}

@Injectable()
export class WidgetAdminTools {
  @McpTool({
    name: 'conv_widget_create_channel',
    description:
      'Create a chat-widget channel and mint a widget API key (`mn_widget_*`) bound to it. Returns the plaintext key once; store it server-side and pass it as `Authorization: Bearer` when calling POST /api/conv/widget/messages from the external agent.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateInput,
  })
  async createChannel(args: z.infer<typeof CreateInput>): Promise<CreateResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const config = WidgetChannelConfig.parse({
      provider: 'widget',
      displayName: args.displayName,
      originAllowlist: args.originAllowlist,
      webhookOnEscalation: args.webhookOnEscalation,
    });

    const [channel] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'chat',
        name: args.name,
        config: config as unknown as Record<string, unknown>,
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
      config,
      widgetKey: rawKey,
    };
  }

  @McpTool({
    name: 'conv_widget_update_channel',
    description:
      'Update a chat-widget channel\'s displayName / originAllowlist / webhookOnEscalation. Pass null to clear webhookOnEscalation. The widget API key is unchanged.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: UpdateInput,
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
      displayName: args.displayName ?? prev.displayName,
      originAllowlist: args.originAllowlist ?? prev.originAllowlist,
      webhookOnEscalation:
        args.webhookOnEscalation === null
          ? undefined
          : (args.webhookOnEscalation ?? prev.webhookOnEscalation),
    });

    const [updated] = await ctx.db
      .update(schema.convChannels)
      .set({ config: next as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, args.channelId))
      .returning();

    return {
      id: updated!.id,
      name: updated!.name,
      type: 'chat',
      active: updated!.active,
      config: next,
    };
  }

  @McpTool({
    name: 'conv_widget_rotate_key',
    description:
      'Revoke any active widget keys bound to this channel and mint a fresh `mn_widget_*` key. Returns the new plaintext key once. Existing inflight requests using the old key keep working until revocation lands.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RotateInput,
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
}
