import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { sensitive } from '@getmunin/types';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { ThrellClientService } from './threll-client.service.ts';
import { ThrellService, jsonbToStored, type ThrellChannelDto } from './threll.service.ts';

const E164 = /^\+[1-9]\d{4,18}$/;

const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  apiKey: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'Threll API key (Settings → Developer). Sent as the `x-api-key` header. Required on create.',
      ),
  ),
  webhookSecret: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'Shared HMAC signing secret. Use the same value here and as the `signingSecret` of the Threll webhook subscription that points at this channel’s webhook URL. Munin verifies the `X-Threll-Signature` HMAC with it and reuses it to sign tool-call deliveries. Required on create.',
      ),
  ),
  accountId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Threll account ID (shown alongside your API key). Required on create.'),
  workerId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Threll worker ID that handles calls on this channel. Required on create.'),
});

const TestInput = z.object({ channelId: z.string() });

const CallInitiateInput = z.object({
  channelId: z.string(),
  to: z.string().regex(E164, 'must be E.164').max(32),
  customerName: z.string().min(1).max(120).optional(),
});

@Injectable()
export class ThrellAdminTools {
  constructor(
    @Inject(ThrellService) private readonly svc: ThrellService,
    @Inject(ThrellClientService) private readonly client: ThrellClientService,
  ) {}

  @McpTool({
    name: 'conv_threll_configure',
    title: 'Conv: Configure Threll voice channel',
    description:
      'Create or update a Threll voice channel. Pass `channelId` to update; omit to create. The plaintext `apiKey` and `webhookSecret` are encrypted before storage and returned redacted. The worker must already exist in Threll — paste its account and worker IDs here.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ConfigureInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async configure(args: z.infer<typeof ConfigureInput>): Promise<ThrellChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        config: {
          apiKey: args.apiKey,
          webhookSecret: args.webhookSecret,
          accountId: args.accountId,
          workerId: args.workerId,
        },
      });
    }
    if (!args.name) throw new BadRequestException('name is required when creating a channel');
    if (!args.apiKey) throw new BadRequestException('apiKey is required when creating');
    if (!args.webhookSecret) throw new BadRequestException('webhookSecret is required when creating');
    if (!args.accountId) throw new BadRequestException('accountId is required when creating');
    if (!args.workerId) throw new BadRequestException('workerId is required when creating');
    return this.svc.createChannel({
      name: args.name,
      config: {
        apiKey: args.apiKey,
        webhookSecret: args.webhookSecret,
        accountId: args.accountId,
        workerId: args.workerId,
      },
    });
  }

  @McpTool({
    name: 'conv_threll_test_channel',
    title: 'Conv: Test Threll voice channel credentials',
    description:
      "Verify a Threll channel's stored API key and worker by fetching the worker from Threll. Returns `{ ok: true, worker }` on success.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: TestInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async testChannel(
    args: z.infer<typeof TestInput>,
  ): Promise<
    { ok: true; worker: { id: string; name: string | null } } | { ok: false; error: string }
  > {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    return this.client.fetchWorker({
      apiKey,
      accountId: config.accountId,
      workerId: config.workerId,
    });
  }

  @McpTool({
    name: 'conv_threll_call_initiate',
    title: 'Conv: Place an outbound Threll voice call',
    description:
      'Initiate an outbound voice call through this Threll channel. The worker runs the conversation. Returns the Threll call id and status.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: CallInitiateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async callInitiate(
    args: z.infer<typeof CallInitiateInput>,
  ): Promise<{ initiated: true; callId: string; status: string }> {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    try {
      const res = await this.client.placeCall({
        apiKey,
        accountId: config.accountId,
        workerId: config.workerId,
        toNumber: args.to,
        customer: args.customerName ? { firstName: args.customerName } : undefined,
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
    if (channel.type !== 'voice' || channel.vendor !== 'threll') {
      throw new BadRequestException(`channel ${channelId} is not a voice:threll channel`);
    }
    return channel;
  }
}
