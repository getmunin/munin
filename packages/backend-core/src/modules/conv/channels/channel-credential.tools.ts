import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { ChannelCredentialService } from './channel-credential.service.ts';

const RequestInput = z.object({ channelId: z.string().min(1) });

@Injectable()
export class ChannelCredentialTools {
  constructor(
    @Inject(ChannelCredentialService) private readonly credentials: ChannelCredentialService,
  ) {}

  @McpTool({
    name: 'conv_request_channel_credentials',
    title: 'Conv: Request a channel credential link',
    description:
      'Return a one-time link a human opens to enter an email channel’s secret credentials (SMTP/IMAP passwords) in the dashboard, so the secret is never pasted into a conversation. Create the channel first (the password may be omitted), then share this link. The link expires after 24 hours.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: RequestInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestCredentials(args: z.infer<typeof RequestInput>) {
    return this.credentials.requestLink(args.channelId);
  }
}
