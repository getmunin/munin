import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { SetChannelSourcesBody } from '@getmunin/types';
import { ChannelSourcesService, type ChannelSourcesDto } from './channel-sources.service.ts';

const GetChannelSourcesInput = z.object({
  channelId: z.string().min(1).max(64).describe('The channel to read, from conv_list_channels.'),
});

const SetChannelSourcesInput = SetChannelSourcesBody.extend({
  channelId: z.string().min(1).max(64).describe('The channel to change, from conv_list_channels.'),
});

@Injectable()
export class ChannelSourcesTools {
  constructor(@Inject(ChannelSourcesService) private readonly sources: ChannelSourcesService) {}

  @McpTool({
    name: 'conv_get_channel_sources',
    title: 'Conv: Get a channel’s knowledge and store sources',
    description:
      'Read which knowledge-base spaces and which commerce/bookings connections the support agent is limited to in conversations from one channel. Empty `kbSpaces` means every self-service document is searchable; an empty `connections` means connections resolve org-wide.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: GetChannelSourcesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  get(args: z.infer<typeof GetChannelSourcesInput>): Promise<ChannelSourcesDto> {
    return this.sources.get(args.channelId);
  }

  @McpTool({
    name: 'conv_set_channel_sources',
    title: 'Conv: Set a channel’s knowledge and store sources',
    description:
      'Limit what the support agent can draw on in conversations from one channel — for an org that runs several sites, each with its own widget. `kbSpaceIds` restricts knowledge-base search and reads to documents in those spaces; `connectionIds` pins the commerce and bookings connection used (at most one per domain), and a tool call naming any other connection is refused. Each list replaces the current one; an empty list removes that restriction and an omitted field is left unchanged. Applies to the support agent and to voice tool calls on that channel’s conversations; teammates and admin agents are never restricted. Returns the channel’s sources after the change.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SetChannelSourcesInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  set(args: z.infer<typeof SetChannelSourcesInput>): Promise<ChannelSourcesDto> {
    return this.sources.set(args);
  }
}
