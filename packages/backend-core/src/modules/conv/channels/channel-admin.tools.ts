import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { AgentModeSchema, sensitive } from '@getmunin/types';
import { ChannelAdminService } from './channel-admin.service.ts';
import { ChannelCredentialService } from './channel-credential.service.ts';
import type { ChannelAdminDto } from './channel-admin.ts';
import type { CredentialLink } from '../../credential-handoff/credential-handoff.service.ts';

const ConfigureInput = z.object({
  vendor: z
    .string()
    .min(1)
    .max(40)
    .describe('Channel vendor, e.g. "vapi", "threll", "twilio", "messagebird". Call conv_list_channel_vendors for the full list and each vendor’s config fields.'),
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional().describe('Channel display name. Required on create.'),
  defaultAgentMode: AgentModeSchema.optional().describe(
    "How the agent handles inbound messages on this channel: 'auto' replies directly, 'draft_only' files a draft for a human, 'off' does neither. SMS channels only — an inbound call is run by the vendor's assistant. Set 'draft_only' on an outreach-only number so replies are never auto-sent.",
  ),
  config: sensitive(
    z
      .record(z.string(), z.unknown())
      .describe(
        'Vendor-specific configuration object with the non-secret fields only — conv_list_channel_vendors marks which fields are secret. Secret fields are rejected here; they are entered by a human through the credential link returned on create.',
      ),
  ),
});

const TestInput = z.object({ channelId: z.string() });

const SendTestInput = z.object({
  channelId: z.string(),
  to: z.string().min(2).max(64),
  body: z.string().min(1).max(1600).optional(),
});

const EmptyInput = z.object({});

const ListOptionsInput = z.object({
  channelId: z
    .string()
    .describe('Discover options for an existing channel using its stored credentials.'),
});

@Injectable()
export class ChannelAdminTools {
  constructor(
    @Inject(ChannelAdminService) private readonly svc: ChannelAdminService,
    @Inject(ChannelCredentialService) private readonly credentials: ChannelCredentialService,
  ) {}

  @McpTool({
    name: 'conv_list_channel_vendors',
    title: 'Conv: List configurable channel vendors',
    description:
      'List the voice/SMS channel vendors you can configure, with each vendor’s `kind`, capabilities (call/sendTest), and config fields (name, required, secret, description). Use this to discover what to pass to conv_configure_channel.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listVendors() {
    return { vendors: this.svc.listVendors() };
  }

  @McpTool({
    name: 'conv_list_channel_options',
    title: 'Conv: List a channel vendor’s selectable options',
    description:
      'Discover the selectable options a channel’s vendor offers using the channel’s stored credentials — e.g. Threll workers, Vapi assistants — so you can pass a valid id to conv_configure_channel instead of guessing. The channel must have completed its credential link first. Returns option `groups` (e.g. `workers`, `assistants`), each with `{ value, label, hint }`.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: ListOptionsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listOptions(args: z.infer<typeof ListOptionsInput>) {
    return this.svc.listOptions({ channelId: args.channelId });
  }

  @McpTool({
    name: 'conv_configure_channel',
    title: 'Conv: Configure a voice/SMS channel',
    description:
      'Create or update a voice or SMS channel for any supported vendor. Pass `vendor` + the vendor’s non-secret `config` fields (see conv_list_channel_vendors). Secret fields are rejected here: creating returns a pending channel plus a one-time link for a human to enter the secrets in the dashboard — the channel activates once they are saved and verified. Pass `channelId` to update; omit to create. `defaultAgentMode` applies to SMS channels only.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ConfigureInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async configure(
    args: z.infer<typeof ConfigureInput>,
  ): Promise<ChannelAdminDto & { credentialLink?: CredentialLink }> {
    const result = await this.svc.configure(
      {
        vendor: args.vendor,
        channelId: args.channelId,
        name: args.name,
        config: args.config,
        defaultAgentMode: args.defaultAgentMode,
      },
      { rejectSecrets: true },
    );
    if (args.channelId || result.active) return result;
    const credentialLink = await this.credentials.requestLink(result.id);
    return { ...result, credentialLink };
  }

  @McpTool({
    name: 'conv_test_channel',
    title: 'Conv: Test a channel’s stored credentials',
    description:
      'Verify a channel’s stored credentials with its vendor (no message sent). The result shape is vendor-specific.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: TestInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  test(args: z.infer<typeof TestInput>): Promise<unknown> {
    return this.svc.test(args.channelId);
  }

  @McpTool({
    name: 'conv_send_channel_test',
    title: 'Conv: Send a real test message',
    description:
      'Send a real test message (e.g. SMS) through a channel that supports it, addressed to `to`. Useful for end-to-end deliverability checks.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendTestInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  sendTest(args: z.infer<typeof SendTestInput>): Promise<unknown> {
    return this.svc.sendTest({ channelId: args.channelId, to: args.to, body: args.body });
  }
}
