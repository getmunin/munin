import { SLACK_EMOJI } from './slack-emoji.generated.ts';

const BOLD = '\u0001';
const ITALIC = '\u0002';
const CODE_OPEN = '\u0003';
const CODE_CLOSE = '\u0004';
const STRIKE = '\u0005';

const VARIATION_SELECTOR = '\uFE0F';

const SKIN_TONES: Record<string, string> = {
  '2': '\u{1F3FB}',
  '3': '\u{1F3FC}',
  '4': '\u{1F3FD}',
  '5': '\u{1F3FE}',
  '6': '\u{1F3FF}',
};

const BULLET_DEPTH: Record<string, number> = { '•': 0, '◦': 1, '▪': 2 };

const BROADCASTS = new Set(['here', 'channel', 'everyone']);

export interface SlackMentionNames {
  users?: Record<string, string>;
  channels?: Record<string, string>;
}

export function unescapeSlackText(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

export function collectSlackMentionIds(text: string): { users: string[]; channels: string[] } {
  const users = new Set<string>();
  const channels = new Set<string>();
  for (const match of text.matchAll(/<([@#])([^|>\s]+)(?:\|([^>]*))?>/g)) {
    if (match[3]) continue;
    const id = match[2];
    if (id === undefined) continue;
    if (match[1] === '@') users.add(id);
    else channels.add(id);
  }
  return { users: [...users], channels: [...channels] };
}

function stash(store: string[], value: string): string {
  store.push(value);
  return `${CODE_OPEN}${store.length - 1}${CODE_CLOSE}`;
}

function applySkinTone(emoji: string, tone: string): string {
  const points = [...emoji];
  const base = points[0];
  if (base === undefined) return emoji;
  const rest = points.slice(1);
  if (rest[0] === VARIATION_SELECTOR) rest.shift();
  return [base, tone, ...rest].join('');
}

function replaceEmoji(text: string): string {
  return text
    .replace(/:([a-zA-Z0-9_+'-]+)::skin-tone-([2-6]):/g, (match, name: string, tone: string) => {
      const emoji = SLACK_EMOJI[name];
      const modifier = SKIN_TONES[tone];
      return emoji !== undefined && modifier !== undefined
        ? applySkinTone(emoji, modifier)
        : match;
    })
    .replace(/:([a-zA-Z0-9_+'-]+):/g, (match, name: string) => SLACK_EMOJI[name] ?? match);
}

function escapeLinkLabel(label: string): string {
  return label.replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function linkTarget(url: string): string {
  return /^(mailto|tel):/.test(url) ? url.slice(url.indexOf(':') + 1) : url;
}

function replaceEntity(
  raw: string,
  body: string,
  names: SlackMentionNames,
  protect: (url: string) => string,
): string {
  const pipe = body.indexOf('|');
  const head = pipe === -1 ? body : body.slice(0, pipe);
  const label = pipe === -1 ? '' : body.slice(pipe + 1);

  if (head.startsWith('@')) {
    const id = head.slice(1);
    return `@${label || names.users?.[id] || id}`;
  }
  if (head.startsWith('#')) {
    const id = head.slice(1);
    return `#${label || names.channels?.[id] || id}`;
  }
  if (head.startsWith('!')) {
    const command = head.slice(1);
    if (BROADCASTS.has(command)) return `@${command}`;
    if (label) return label;
    if (command.startsWith('subteam^')) return '@team';
    return raw;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(head)) return raw;

  const target = linkTarget(head);
  if (!label || label === head || label === target) return protect(target);
  return `[${escapeLinkLabel(label)}](${protect(head)})`;
}

function convertBlockLine(line: string): string {
  const bullet = /^([ \t]*)([•◦▪])[ \t]+(.*)$/.exec(line);
  if (bullet) {
    const depth = BULLET_DEPTH[bullet[2] ?? ''] ?? 0;
    return `${'  '.repeat(depth)}- ${bullet[3] ?? ''}`;
  }
  const quote = /^ {0,3}&gt;[ \t]?(.*)$/.exec(line);
  if (quote) return `> ${quote[1] ?? ''}`;
  return line;
}

function convertBlocks(text: string): string {
  const out: string[] = [];
  let quoting = false;
  for (const line of text.split('\n')) {
    if (quoting) {
      out.push(`> ${line}`);
      continue;
    }
    const multiline = /^ {0,3}(?:&gt;){3}[ \t]?(.*)$/.exec(line);
    if (multiline) {
      quoting = true;
      out.push(`> ${multiline[1] ?? ''}`);
      continue;
    }
    out.push(convertBlockLine(line));
  }
  return out.join('\n');
}

export function mrkdwnToMarkdown(text: string, names: SlackMentionNames = {}): string {
  const code: string[] = [];
  const stashed = text
    .replaceAll('\r\n', '\n')
    .replace(/```\n?([\s\S]*?)```/g, (_match, body: string) =>
      stash(code, `\`\`\`\n${unescapeSlackText(body.replace(/^\n+|\n+$/g, ''))}\n\`\`\``),
    )
    .replace(/`([^`\n]+)`/g, (_match, body: string) => stash(code, `\`${unescapeSlackText(body)}\``));

  const inline = convertBlocks(stashed)
    .replace(/<([^<>\n]*)>/g, (raw: string, body: string) =>
      replaceEntity(raw, body, names, (url) => stash(code, unescapeSlackText(url))),
    )
    .replace(/(?<![\w*\\])\*(?=[^\s*])([^*\n]*[^\s*]|)\*(?!\w)/g, `${BOLD}$1${BOLD}`)
    .replace(/(?<![\w\\])_(?=[^\s_])([^_\n]*[^\s_]|)_(?!\w)/g, `${ITALIC}$1${ITALIC}`)
    .replace(/(?<![\w~\\])~(?=[^\s~])([^~\n]*[^\s~]|)~(?!\w)/g, `${STRIKE}$1${STRIKE}`);

  return unescapeSlackText(replaceEmoji(inline))
    .replace(
      new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g'),
      (_match, index: string) => code[Number(index)] ?? '',
    )
    .replaceAll(BOLD, '**')
    .replaceAll(ITALIC, '*')
    .replaceAll(STRIKE, '~~');
}
