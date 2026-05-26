import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { VapiClientService } from './vapi-client.service.ts';
import {
  VapiService,
  jsonbToStored,
  type VapiChannelDto,
} from './vapi.service.ts';

const E164 = /^\+[1-9]\d{4,18}$/;

const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  apiKey: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe('Vapi API key. Required on create. On update, omit to keep the existing value.'),
  webhookSecret: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe(
      'Shared secret used to authenticate inbound webhooks from Vapi. In the Vapi dashboard go to the assistant\'s Advanced → Webhook Server → HTTP Headers and add header `X-Webhook-Secret` with this value. Required on create.',
    ),
  assistantId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Vapi assistant ID. Create the assistant in the Vapi dashboard or via their API, then paste its ID here.'),
  phoneNumberId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Vapi phone number ID. Only required if you want to place or receive PSTN phone calls — leave blank for WebRTC/browser-only voice. Either import a Twilio number into Vapi or buy one from Vapi, then paste the ID here.'),
  publicKey: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe('Vapi public key — safe to expose to the browser. Required if you want the chat widget to start in-browser voice sessions; not needed for phone-only setups. Find it in the Vapi dashboard under your assistant.'),
});

const TestInput = z.object({ channelId: z.string() });

const CallInitiateInput = z.object({
  channelId: z.string(),
  to: z.string().regex(E164, 'must be E.164').max(32),
  customerName: z.string().min(1).max(120).optional(),
});

@Injectable()
export class VapiAdminTools {
  constructor(
    @Inject(VapiService) private readonly svc: VapiService,
    @Inject(VapiClientService) private readonly client: VapiClientService,
  ) {}

  @McpTool({
    name: 'conv_vapi_configure',
    title: 'Conv: Configure Vapi voice channel',
    description:
      'Create or update a Vapi voice channel. Pass `channelId` to update; omit to create. The plaintext `apiKey` and `webhookSecret` are encrypted before storage and returned redacted. The assistant + phone number must already exist in Vapi — paste their IDs here.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ConfigureInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async configure(args: z.infer<typeof ConfigureInput>): Promise<VapiChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        config: {
          apiKey: args.apiKey,
          webhookSecret: args.webhookSecret,
          assistantId: args.assistantId,
          phoneNumberId: args.phoneNumberId,
          publicKey: args.publicKey,
        },
      });
    }
    if (!args.name) throw new BadRequestException('name is required when creating a channel');
    if (!args.apiKey) throw new BadRequestException('apiKey is required when creating');
    if (!args.webhookSecret) throw new BadRequestException('webhookSecret is required when creating');
    if (!args.assistantId) throw new BadRequestException('assistantId is required when creating');
    return this.svc.createChannel({
      name: args.name,
      config: {
        apiKey: args.apiKey,
        webhookSecret: args.webhookSecret,
        assistantId: args.assistantId,
        phoneNumberId: args.phoneNumberId,
        publicKey: args.publicKey,
      },
    });
  }

  @McpTool({
    name: 'conv_vapi_test_channel',
    title: 'Conv: Test Vapi voice channel credentials',
    description:
      "Verify a Vapi channel's stored API key and assistant by fetching the assistant from Vapi. Returns `{ ok: true, assistant }` on success.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: TestInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async testChannel(
    args: z.infer<typeof TestInput>,
  ): Promise<
    { ok: true; assistant: { id: string; name: string | null } } | { ok: false; error: string }
  > {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    return this.client.fetchAssistant({ apiKey, assistantId: config.assistantId });
  }

  @McpTool({
    name: 'conv_voice_call_initiate',
    title: 'Conv: Place an outbound voice call',
    description:
      'Initiate an outbound voice call through this channel. The Vapi assistant will run the conversation. Returns the Vapi call id and status.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CallInitiateInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async callInitiate(
    args: z.infer<typeof CallInitiateInput>,
  ): Promise<{ initiated: true; callId: string; status: string }> {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    if (!config.phoneNumberId) {
      throw new BadRequestException(
        'channel has no phoneNumberId — set one in the channel config to place outbound PSTN calls',
      );
    }
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    try {
      const res = await this.client.placeCall({
        apiKey,
        assistantId: config.assistantId,
        phoneNumberId: config.phoneNumberId,
        toNumber: args.to,
        customer: args.customerName ? { name: args.customerName } : undefined,
      });
      return { initiated: true, callId: res.id, status: res.status };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  private async loadChannel(channelId: string): Promise<typeof schema.convChannels.$inferSelect> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, channelId),
          eq(schema.convChannels.orgId, actor.orgId),
        ),
      )
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`channel ${channelId} not found`);
    if (channel.type !== 'voice' || channel.vendor !== 'vapi') {
      throw new BadRequestException(`channel ${channelId} is not a voice:vapi channel`);
    }
    return channel;
  }
}
