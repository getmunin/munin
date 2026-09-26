const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function textOutsideTags(fragment: string): string {
  let text = '';
  let inTag = false;
  for (const ch of fragment) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) text += ch;
  }
  return text;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!match) return null;
  return decodeHtmlEntities(match[2] ?? match[3] ?? '');
}

export function teamsHtmlToMarkdown(input: string, options: { dropMentions?: string[] } = {}): string {
  if (!/<[a-z!/][^>]*>/i.test(input)) return decodeHtmlEntities(input).trim();

  const dropped = new Set((options.dropMentions ?? []).map((m) => m.trim().toLowerCase()));
  const html = input.replace(/<at\b[^>]*>([\s\S]*?)<\/at>/gi, (_whole, inner: string) => {
    const name = decodeHtmlEntities(textOutsideTags(inner))
      .replace(/[<>]/g, '')
      .trim();
    return dropped.has(name.toLowerCase()) ? '' : `@${name}`;
  });

  const out: string[] = [];
  let inPre = 0;
  let linkHref: string | null = null;
  let linkTextStart = 0;
  const tokens = html.split(/(<[^>]*>)/);

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      const text = decodeHtmlEntities(token);
      out.push(inPre > 0 ? text : text.replace(/[ \t\r\n]+/g, ' '));
      continue;
    }
    const match = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(token);
    if (!match) continue;
    const closing = match[1] === '/';
    const tag = match[2]!.toLowerCase();
    switch (tag) {
      case 'br':
        out.push('\n');
        break;
      case 'p':
      case 'div':
        out.push(closing ? '\n\n' : '\n');
        break;
      case 'strong':
      case 'b':
        out.push('**');
        break;
      case 'em':
      case 'i':
        out.push('_');
        break;
      case 's':
      case 'strike':
      case 'del':
        out.push('~~');
        break;
      case 'code':
        if (inPre === 0) out.push('`');
        break;
      case 'pre':
        if (closing) {
          inPre = Math.max(0, inPre - 1);
          out.push('\n```\n');
        } else {
          inPre += 1;
          out.push('\n```\n');
        }
        break;
      case 'li':
        if (!closing) out.push('\n- ');
        break;
      case 'ul':
      case 'ol':
        out.push('\n');
        break;
      case 'blockquote':
        out.push(closing ? '\n' : '\n> ');
        break;
      case 'a':
        if (closing) {
          if (linkHref !== null) {
            const text = out.splice(linkTextStart).join('').trim();
            out.push(!text || text === linkHref ? linkHref : `[${text}](${linkHref})`);
          }
          linkHref = null;
        } else {
          const href = attribute(token, 'href');
          linkHref = href && /^(https?:|mailto:)/i.test(href) ? href : null;
          linkTextStart = out.length;
        }
        break;
      case 'img':
      case 'emoji': {
        const alt = attribute(token, 'alt');
        if (alt) out.push(alt);
        break;
      }
      default:
        break;
    }
  }

  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?![-> ])/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
