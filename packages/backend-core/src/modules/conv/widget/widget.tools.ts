import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { WidgetChannelAdminService } from './widget-channel-admin.service.ts';

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

@Injectable()
export class WidgetAdminTools {
  constructor(
    @Inject(WidgetChannelAdminService) private readonly widget: WidgetChannelAdminService,
  ) {}

  @McpTool({
    name: 'conv_widget_create_channel',
    title: 'Conv: Create chat-widget channel',
    description:
      'Create a chat-widget channel and mint a widget API key (`mn_widget_*`) bound to it. Returns the plaintext key once; store it server-side and pass it as `Authorization: Bearer` when calling POST /v1/widget/messages from the external agent. Scaffolding a frontend from Lovable/Bolt/v0/Replit/Cursor? Read `skill://playbooks/frontend-integration` first — it covers the widget + tracker + CMS wiring end-to-end.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CreateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createChannel(args: z.infer<typeof CreateInput>) {
    return this.widget.createChannel(args);
  }

  @McpTool({
    name: 'conv_widget_update_channel',
    title: 'Conv: Update chat-widget channel',
    description:
      'Update a chat-widget channel\'s originAllowlist / webhookOnEscalation. Pass null to clear webhookOnEscalation. The widget API key is unchanged.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: UpdateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateChannel(args: z.infer<typeof UpdateInput>) {
    return this.widget.updateChannel(args);
  }

  @McpTool({
    name: 'conv_widget_rotate_key',
    title: 'Conv: Rotate widget API key',
    description:
      'Revoke any active widget keys bound to this channel and mint a fresh `mn_widget_*` key. Returns the new plaintext key once. Existing inflight requests using the old key keep working until revocation lands.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RotateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  rotateKey(args: z.infer<typeof RotateInput>) {
    return this.widget.rotateKey(args);
  }

  @McpTool({
    name: 'conv_widget_rotate_identity_secret',
    title: 'Conv: Rotate widget identity-verification secret',
    description:
      'Generate a fresh per-channel HMAC secret used to verify browser-side `data-user-hash` values against `data-external-id`. The previous secret is replaced atomically; any previously-issued user hashes stop verifying immediately and the operator must re-render their pages with newly-computed hashes. Returns the new plaintext once.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RotateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  rotateIdentitySecret(args: z.infer<typeof RotateInput>) {
    return this.widget.rotateIdentitySecret(args);
  }
}
