import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { TeamsService } from './teams.service.ts';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EmptyInput = z.object({});

const CreateConnectionInput = z.object({
  appId: z
    .string()
    .regex(GUID, 'must be a GUID')
    .describe("The bot's Microsoft App ID (a GUID) from the Teams Developer Portal or the Azure Bot resource"),
  tenantId: z
    .string()
    .regex(GUID, 'must be a GUID')
    .describe('The Microsoft Entra tenant ID (a GUID) the bot is registered in — the organisation that uses Teams'),
});

const SetRoutingInputSchema = z.object({
  teamsChannelId: z
    .string()
    .min(1)
    .max(256)
    .describe('Teams channel ID from teams_list_channels, e.g. 19:abc…@thread.tacv2'),
  purpose: z
    .enum(['default', 'escalations'])
    .optional()
    .describe(
      "'default' (every mirrored conversation; required before mirroring starts) or 'escalations' (handover alerts; falls back to the default channel when unset)",
    ),
  convChannelId: z
    .string()
    .max(64)
    .optional()
    .describe(
      'Optional source-channel override: conversations arriving on this Munin conversation channel (see conv_list_channels) mirror into the given Teams channel instead of the default',
    ),
});

const LinkUserInput = z.object({
  aadObjectId: z
    .string()
    .regex(GUID, 'must be a GUID')
    .describe("The person's Microsoft Entra object ID (a GUID)"),
  userId: z.string().min(1).max(64).describe('Munin user ID of the org member (usr_…)'),
});

const UnlinkUserInput = z.object({
  aadObjectId: z.string().regex(GUID, 'must be a GUID'),
});

@Injectable()
export class TeamsAdminTools {
  constructor(@Inject(TeamsService) private readonly teams: TeamsService) {}

  @McpTool({
    name: 'teams_get_status',
    title: 'Teams: Get status',
    description:
      "Show the org's Microsoft Teams connection: the bot app id and tenant, whether its client secret is stored (credentialState), the teams the bot is installed in, channel routing, mirror-delivery counts (pending + failed in the last 24h), and the messaging endpoint the bot registration must point at. The client secret is never returned.",
    audiences: ['admin'],
    scopes: ['teams:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getStatus() {
    return this.teams.status();
  }

  @McpTool({
    name: 'teams_create_connection',
    title: 'Teams: Create connection',
    description:
      "Connect the org's own Microsoft Teams bot by its app id and Entra tenant id. Returns a one-time credentials link a human opens to enter the bot's client secret (secrets are never accepted in a conversation) and the messaging endpoint to set on the bot registration. Fails when the org already has a bot connected or the app id belongs to another org.",
    audiences: ['admin'],
    scopes: ['teams:write'],
    input: CreateConnectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createConnection(args: z.infer<typeof CreateConnectionInput>) {
    return this.teams.createConnection(args);
  }

  @McpTool({
    name: 'teams_request_credentials',
    title: 'Teams: Request credentials link',
    description:
      "Return a fresh one-time link a human opens to enter or rotate the Teams bot's client secret. The link expires after 24 hours.",
    audiences: ['admin'],
    scopes: ['teams:write'],
    input: EmptyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestCredentials() {
    return this.teams.requestCredentials();
  }

  @McpTool({
    name: 'teams_list_channels',
    title: 'Teams: List channels',
    description:
      'List the channels of every team the Munin bot is installed in (channel id, name, team) — the ids teams_set_routing accepts. A team only appears after the Munin app has been added to it.',
    audiences: ['admin'],
    scopes: ['teams:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listChannels() {
    return this.teams.listChannels();
  }

  @McpTool({
    name: 'teams_set_routing',
    title: 'Teams: Set channel routing',
    description:
      "Point conversation mirroring at a Teams channel. purpose 'default' receives every conversation as a thread; purpose 'escalations' receives handover alerts; convChannelId scopes a route to one source conversation channel. Calling again with the same purpose or convChannelId replaces that route. Every route needs its own Teams channel, and the channel must be in a team the bot is installed in.",
    audiences: ['admin'],
    scopes: ['teams:write'],
    input: SetRoutingInputSchema,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setRouting(args: z.infer<typeof SetRoutingInputSchema>) {
    return this.teams.setRouting(args);
  }

  @McpTool({
    name: 'teams_send_test_message',
    title: 'Teams: Send test message',
    description:
      'Post a test message to the configured default Teams channel to verify the connection end-to-end. Fails with a specific error when no bot is connected, the client secret is missing or rejected, no default route is set, or the bot is no longer installed in that team.',
    audiences: ['admin'],
    scopes: ['teams:write'],
    input: EmptyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  sendTest() {
    return this.teams.sendTest();
  }

  @McpTool({
    name: 'teams_list_user_links',
    title: 'Teams: List user links',
    description:
      'List the Teams-user ↔ Munin-member links used to attribute thread replies and card button clicks. Links are created automatically by matching the Teams account email or UPN to a member email on first use, or manually with teams_link_user.',
    audiences: ['admin'],
    scopes: ['teams:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listUserLinks() {
    return this.teams.listUserLinks();
  }

  @McpTool({
    name: 'teams_link_user',
    title: 'Teams: Link a user',
    description:
      "Manually link a Teams user (Entra object id) to a Munin org member so their thread replies and button clicks are attributed to that member. Use when the Teams account's email and UPN differ from the member email. Linking again replaces the previous mapping for that Teams user.",
    audiences: ['admin'],
    scopes: ['teams:write'],
    input: LinkUserInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  linkUser(args: z.infer<typeof LinkUserInput>) {
    return this.teams.linkUser(args);
  }

  @McpTool({
    name: 'teams_unlink_user',
    title: 'Teams: Unlink a user',
    description:
      'Remove a Teams-user ↔ Munin-member link. Their next thread reply or button click is rejected until re-linked (manually or by email auto-match).',
    audiences: ['admin'],
    scopes: ['teams:write'],
    input: UnlinkUserInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  unlinkUser(args: z.infer<typeof UnlinkUserInput>) {
    return this.teams.unlinkUser(args);
  }

  @McpTool({
    name: 'teams_disconnect',
    title: 'Teams: Disconnect bot',
    description:
      "Disconnect the org's Teams bot. Deletes the stored client secret, installed-team records, channel routing, and all conversation/message thread links; existing Teams messages stay in Teams and conversations in Munin are unaffected. Remove the app from Teams separately if it should stop appearing there.",
    audiences: ['admin'],
    scopes: ['teams:write'],
    input: EmptyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  disconnect() {
    return this.teams.disconnect();
  }
}
