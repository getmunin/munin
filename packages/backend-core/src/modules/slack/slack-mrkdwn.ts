const BOLD = '\u0001';
const ITALIC = '\u0002';
const CODE_OPEN = '\u0003';
const CODE_CLOSE = '\u0004';

export function escapeSlackText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const BULLETS = ['•', '◦', '▪'];

function stash(store: string[], value: string): string {
  store.push(value);
  return `${CODE_OPEN}${store.length - 1}${CODE_CLOSE}`;
}

function slackLink(url: string, label: string): string {
  const target = /^(https?:|mailto:|tel:)/i.test(url)
    ? url
    : /^www\./i.test(url)
      ? `https://${url}`
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)
        ? `mailto:${url}`
        : null;
  if (!target) return label;
  return `<${target}|${label}>`;
}

function indentWidth(indent: string): number {
  return indent.replaceAll('\t', '  ').length;
}

function convertBlockLine(line: string): string[] {
  if (/^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/.test(line)) return [];

  const heading = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*$/.exec(line);
  if (heading) {
    const text = (heading[1] ?? '').replaceAll('**', '').replaceAll('__', '');
    return text.length > 0 ? [`${BOLD}${text}${BOLD}`] : [];
  }

  const quote = /^ {0,3}&gt;[ \t]?(.*)$/.exec(line);
  if (quote) return [`> ${quote[1] ?? ''}`];

  const bullet = /^([ \t]*)[-*+][ \t]+(.*)$/.exec(line);
  if (bullet) {
    const indent = bullet[1] ?? '';
    const depth = Math.min(Math.floor(indentWidth(indent) / 2), BULLETS.length - 1);
    const marker = BULLETS[depth] ?? BULLETS[0];
    const rest = bullet[2] ?? '';
    const task = /^\[([ xX])\][ \t]+(.*)$/.exec(rest);
    const content = task ? `${task[1] === ' ' ? '☐' : '☑'} ${task[2] ?? ''}` : rest;
    return [`${indent}${marker} ${content}`];
  }

  return [line];
}

export function markdownToMrkdwn(markdown: string): string {
  const code: string[] = [];
  const stashed = markdown
    .replaceAll('\r\n', '\n')
    .replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_match, body: string) =>
      stash(code, `\`\`\`\n${escapeSlackText(body.replace(/^\n+|\n+$/g, ''))}\n\`\`\``),
    )
    .replace(/`([^`\n]+)`/g, (_match, body: string) =>
      stash(code, `\`${escapeSlackText(body)}\``),
    );

  const blocks = escapeSlackText(stashed)
    .split('\n')
    .flatMap(convertBlockLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return blocks
    .replace(/&lt;(https?:\/\/[^\s|&]+)&gt;/g, '<$1>')
    .replace(
      /!\[([^\]\n]*)\]\(\s*([^)\s]+?)(?:\s+"[^"\n]*")?\s*\)/g,
      (_match, alt: string, url: string) => slackLink(url, alt || url),
    )
    .replace(
      /\[([^\]\n]*)\]\(\s*([^)\s]+?)(?:\s+"[^"\n]*")?\s*\)/g,
      (_match, label: string, url: string) => slackLink(url, label || url),
    )
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, `${BOLD}$1${BOLD}`)
    .replace(/(?<![\w\\])__(?=\S)([\s\S]*?\S)__(?!\w)/g, `${BOLD}$1${BOLD}`)
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '~$1~')
    .replace(/(?<![\w*\\])\*(?=[^\s*])([^*\n]*[^\s*]|)\*(?!\w)/g, `${ITALIC}$1${ITALIC}`)
    .replace(/\\([\\`*_~[\]()#+\-.!>])/g, '$1')
    .replace(
      new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g'),
      (_match, index: string) => code[Number(index)] ?? '',
    )
    .replaceAll(BOLD, '*')
    .replaceAll(ITALIC, '_');
}
