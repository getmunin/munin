import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLACK_BOT_SCOPES } from './slack.constants.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..');

interface SlackAppManifest {
  features: unknown;
  oauth_config: { scopes: { bot: string[] } };
  settings: unknown;
}

function readManifest(): SlackAppManifest {
  return JSON.parse(
    readFileSync(join(repoRoot, 'slack-app-manifest.json'), 'utf8'),
  ) as SlackAppManifest;
}

function readSkillManifest(): SlackAppManifest {
  const skill = readFileSync(join(here, 'skills', 'connect-slack.md'), 'utf8');
  const block = skill.match(/```json\n([\s\S]*?)\n```/);
  if (!block) throw new Error('connect-slack.md has no json manifest block');
  return JSON.parse(block[1]!) as SlackAppManifest;
}

describe('slack-app-manifest.json', () => {
  it('declares exactly the bot scopes the bridge requests', () => {
    expect(readManifest().oauth_config.scopes.bot).toEqual([...SLACK_BOT_SCOPES]);
  });

  it('stays in sync with the manifest inlined in the connect-slack skill', () => {
    const file = readManifest();
    const skill = readSkillManifest();
    expect(skill.oauth_config).toEqual(file.oauth_config);
    expect(skill.settings).toEqual(file.settings);
    expect(skill.features).toEqual(file.features);
  });
});
