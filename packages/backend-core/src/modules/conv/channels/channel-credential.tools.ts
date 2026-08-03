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
      'Return a one-time link a human opens to enter a channel’s secret credentials in the dashboard — secrets are never accepted in a conversation. Works for any channel kind: email (SMTP/IMAP passwords) as well as voice and SMS vendor keys. conv_configure_email_channel and conv_configure_vendor_channel already return this link on create; use this tool to mint a fresh link when one expired or to rotate the stored secrets. The link expires after 24 hours.',
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
