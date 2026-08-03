import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentModeSchema, RedditUsernameSchema, SendLimitsSchema, sensitive } from '@getmunin/types';
import { RedditApiError, RedditClientService } from './reddit-client.service.ts';
import {
  DEFAULT_REDDIT_SEND_LIMITS,
  RedditService,
  jsonbToStored,
  type RedditChannelDto,
} from './reddit.service.ts';

export const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  defaultAgentMode: AgentModeSchema.optional().describe(
    "How the agent handles inbound Reddit comments and DMs on this channel: 'auto' replies directly, 'draft_only' files a draft for a human, 'off' does neither.",
  ),
  clientId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      'Client id of the Reddit "script" app (reddit.com/prefs/apps). Required on create.',
    ),
  clientSecret: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'Client secret of that script app. Required on create. On update, omit to keep the stored secret, or pass a new value to rotate.',
      ),
  ),
  username: RedditUsernameSchema.optional().describe(
    'Reddit account the script app belongs to, without the "u/" prefix. Comments and DMs are posted as this account. Required on create.',
  ),
  password: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'Password of that Reddit account. Required on create. On update, omit to keep the stored password, or pass a new value to rotate.',
      ),
  ),
  sendLimits: SendLimitsSchema.optional().describe(
    `Outbound pacing for this Reddit account. Defaults to ${DEFAULT_REDDIT_SEND_LIMITS.perHourMax} sends per hour and ${DEFAULT_REDDIT_SEND_LIMITS.perDayMax} per day, which keeps a young account under Reddit's own comment throttle.`,
  ),
});

@Injectable()
export class RedditAdminService {
  constructor(
    @Inject(RedditService) private readonly svc: RedditService,
    @Inject(RedditClientService) private readonly client: RedditClientService,
  ) {}

  completeSetup(
    channelId: string,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    return this.svc.completeSetup(channelId, secrets);
  }

  async configure(args: z.infer<typeof ConfigureInput>): Promise<RedditChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        defaultAgentMode: args.defaultAgentMode,
        config: {
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          username: args.username,
          password: args.password,
          sendLimits: args.sendLimits,
        },
      });
    }
    if (!args.name) {
      throw new BadRequestException('conv_invalid: name is required when creating a channel');
    }
    const missing = (['clientId', 'clientSecret', 'username', 'password'] as const).filter(
      (key) => !args[key],
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `conv_invalid: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required when creating a channel`,
      );
    }
    return this.svc.createChannel({
      name: args.name,
      defaultAgentMode: args.defaultAgentMode,
      config: {
        clientId: args.clientId!,
        clientSecret: args.clientSecret!,
        username: args.username!,
        password: args.password!,
        ...(args.sendLimits ? { sendLimits: args.sendLimits } : {}),
      },
    });
  }

  async testChannel(args: { channelId: string }): Promise<
    | {
        ok: true;
        username: string;
        linkKarma: number | null;
        commentKarma: number | null;
        totalKarma: number | null;
        isSuspended: boolean;
      }
    | { ok: false; error: string }
  > {
    const channel = await this.svc.requireChannel(args.channelId);
    const credentials = await this.svc.loadCredentials(channel.id, jsonbToStored(channel.config));
    try {
      const me = await this.client.getMe(credentials);
      return {
        ok: true,
        username: me.data.username,
        linkKarma: me.data.linkKarma,
        commentKarma: me.data.commentKarma,
        totalKarma: me.data.totalKarma,
        isSuspended: me.data.isSuspended,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendTest(args: {
    channelId: string;
    to: string;
    body?: string;
  }): Promise<{ delivered: true; fullname: string | null }> {
    const channel = await this.svc.requireChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const credentials = await this.svc.loadCredentials(channel.id, config);
    const recipient = args.to.replace(/^\/?u\//i, '').trim();
    if (!recipient) {
      throw new BadRequestException('conv_invalid: to must be a Reddit username');
    }
    try {
      const res = await this.client.sendDm(credentials, {
        to: recipient,
        subject: `Munin test message from /u/${config.username}`,
        text: args.body ?? 'Munin test message — outbound Reddit direct messages are working.',
      });
      return { delivered: true, fullname: res.data.fullname };
    } catch (err) {
      if (err instanceof RedditApiError) throw new BadRequestException(err.message);
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }
}
