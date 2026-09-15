#!/usr/bin/env node
// Regenerates packages/backend-core/src/modules/slack/slack-emoji.generated.ts from
// iamcal/emoji-data, the dataset Slack's own shortcode names come from.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://raw.githubusercontent.com/iamcal/emoji-data/master/emoji.json';

const OUT = fileURLToPath(
  new URL('../packages/backend-core/src/modules/slack/slack-emoji.generated.ts', import.meta.url),
);

// Shortcodes Slack ships that upstream has no name for.
const SLACK_ONLY = { simple_smile: '1F642' };

function toChars(unified) {
  return String.fromCodePoint(...unified.split('-').map((hex) => Number.parseInt(hex, 16)));
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch ${SOURCE} failed: ${res.status}`);
const data = await res.json();

const byName = new Map();
for (const emoji of data) {
  if (typeof emoji.unified !== 'string') continue;
  for (const name of emoji.short_names ?? []) {
    // Skin tones are combining modifiers, never standalone emoji; the converter owns them.
    if (name.startsWith('skin-tone-')) continue;
    if (!byName.has(name)) byName.set(name, emoji.unified);
  }
}
for (const [name, unified] of Object.entries(SLACK_ONLY)) {
  if (!byName.has(name)) byName.set(name, unified);
}

const lines = [...byName.keys()]
  .sort()
  .map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(toChars(byName.get(name)))},`);

writeFileSync(OUT, `export const SLACK_EMOJI: Record<string, string> = {\n${lines.join('\n')}\n};\n`);
console.log(`wrote ${lines.length} shortcodes to ${OUT}`);
