import { readApiBaseUrl } from '@getmunin/core';
import { TEAMS_COLOR_ICON_PNG_BASE64, TEAMS_OUTLINE_ICON_PNG_BASE64 } from './teams-icons.generated.ts';
import { createStoredZip } from './teams-zip.ts';

export const TEAMS_MANIFEST_VERSION = '1.25';

export function buildTeamsManifest(input: { appId: string; orgName: string | null }): Record<string, unknown> {
  const apiHost = new URL(readApiBaseUrl()).hostname;
  const shortName = 'Munin';
  const full = input.orgName ? `Munin for ${input.orgName}` : 'Munin';
  return {
    $schema: `https://developer.microsoft.com/json-schemas/teams/v${TEAMS_MANIFEST_VERSION}/MicrosoftTeams.schema.json`,
    manifestVersion: TEAMS_MANIFEST_VERSION,
    version: '1.0.0',
    id: input.appId,
    developer: {
      name: 'Munin',
      websiteUrl: 'https://getmunin.com',
      privacyUrl: 'https://getmunin.com/privacy',
      termsOfUseUrl: 'https://getmunin.com/terms',
    },
    name: { short: shortName, full: full.slice(0, 100) },
    description: {
      short: 'Triage customer conversations and reply from Teams.',
      full: 'Mirrors Munin customer conversations into a Teams channel, one thread per conversation. Reply in the thread to answer the customer over their original channel, and take over, release, or close conversations from the thread card.',
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: '#2D2A26',
    bots: [
      {
        botId: input.appId,
        scopes: ['team'],
        isNotificationOnly: false,
        supportsFiles: false,
      },
    ],
    validDomains: [apiHost],
    webApplicationInfo: { id: input.appId, resource: `api://botid-${input.appId}` },
    authorization: {
      permissions: {
        resourceSpecific: [{ name: 'ChannelMessage.Read.Group', type: 'Application' }],
      },
    },
  };
}

export function buildTeamsAppPackage(input: { appId: string; orgName: string | null }): Buffer {
  const manifest = buildTeamsManifest(input);
  return createStoredZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'color.png', data: Buffer.from(TEAMS_COLOR_ICON_PNG_BASE64, 'base64') },
    { name: 'outline.png', data: Buffer.from(TEAMS_OUTLINE_ICON_PNG_BASE64, 'base64') },
  ]);
}
