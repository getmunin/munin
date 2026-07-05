import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { SlackService } from './slack.service.ts';

const EmptyInput = z.object({});

const SetRoutingInputSchema = z.object({
  slackChannelId: z
    .string()
    .min(1)
    .max(32)
    .describe('Slack channel ID (e.g. C0123456789), not the #name'),
  purpose: z
    .enum(['default', 'escalations'])
    .optional()
    .describe(
      "'default' (all mirrored conversations; required before mirroring starts) or 'escalations' (handover alerts; falls back to the default channel when unset)",
    ),
  mention: z
    .string()
    .max(64)
    .optional()
    .describe(
      'Optional Slack mention prepended to escalation alerts, e.g. <!here> or <!subteam^S0123456789>',
    ),
  convChannelId: z
    .string()
    .max(64)
    .optional()
    .describe(
      'Optional source-channel override: conversations arriving on this Munin conversation channel (see conv_list_channels) mirror into the given Slack channel instead of the default',
    ),
});

@Injectable()
export class SlackAdminTools {
  constructor(@Inject(SlackService) private readonly slack: SlackService) {}

  @McpTool({
    name: 'slack_get_install_url',
    title: 'Slack: Get install link',
    description:
      'Return the Slack OAuth link that connects a Slack workspace to this org. The link must be opened and approved in a browser by a workspace admin; it expires after 10 minutes (call again for a fresh one). After installing, pick a channel with slack_set_routing. Fails when the deployment has no Slack app configured (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET).',
    audiences: ['admin'],
    scopes: ['slack:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getInstallUrl() {
    return this.slack.installUrl();
  }

  @McpTool({
    name: 'slack_get_status',
    title: 'Slack: Get status',
    description:
      'Show the org\'s Slack connection: whether the deployment has a Slack app configured, the connected workspace, channel routing, and mirror-delivery counts (pending + failed in the last 24h). The bot token is never returned.',
    audiences: ['admin'],
    scopes: ['slack:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getStatus() {
    return this.slack.status();
  }

  @McpTool({
    name: 'slack_set_routing',
    title: 'Slack: Set channel routing',
    description:
      "Point conversation mirroring at a Slack channel. purpose 'default' receives every conversation as a thread; purpose 'escalations' receives handover alerts (optionally with a mention); convChannelId scopes a route to one source conversation channel (e.g. widget → #support-chat, email → #support-email). Calling again with the same purpose or convChannelId replaces that route. Every route needs its own Slack channel, and a Slack channel can only serve one Munin org. The response includes botInChannel — when false, invite the bot in Slack (/invite) before messages can post.",
    audiences: ['admin'],
    scopes: ['slack:write'],
    input: SetRoutingInputSchema,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setRouting(args: z.infer<typeof SetRoutingInputSchema>) {
    return this.slack.setRouting(args);
  }

  @McpTool({
    name: 'slack_test',
    title: 'Slack: Send test message',
    description:
      'Post a test message to the configured default Slack channel to verify the connection end-to-end. Fails with a specific error when the workspace is not connected, no default route is set, or the bot has not been invited to the channel.',
    audiences: ['admin'],
    scopes: ['slack:write'],
    input: EmptyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  sendTest() {
    return this.slack.sendTest();
  }

  @McpTool({
    name: 'slack_disconnect',
    title: 'Slack: Disconnect workspace',
    description:
      'Disconnect the org\'s Slack workspace. Deletes the stored bot token, channel routing, and all conversation/message thread links; existing Slack messages remain in Slack. Conversations in Munin are unaffected. Reconnect any time with slack_get_install_url.',
    audiences: ['admin'],
    scopes: ['slack:write'],
    input: EmptyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  disconnect() {
    return this.slack.disconnect();
  }
}
