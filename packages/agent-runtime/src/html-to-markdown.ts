const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*?)\/?>/g;
const CODE_RE = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g;

const PARAGRAPH_TAGS = new Set(['p', 'pre', 'blockquote', 'hr']);
const LINE_TAGS = new Set(['div', 'section', 'article', 'header', 'footer']);
const LIST_TAGS = new Set(['ul', 'ol']);
const HEADING_RE = /^h[1-6]$/;
const STRONG_TAGS = new Set(['strong', 'b']);
const EM_TAGS = new Set(['em', 'i']);
const STRIP_TAGS = new Set(['span', 'u', 'font', 'small', 'mark', 'sup', 'sub', 'html', 'body']);
const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

function isKnownTag(name: string): boolean {
  return (
    PARAGRAPH_TAGS.has(name) ||
    LINE_TAGS.has(name) ||
    LIST_TAGS.has(name) ||
    HEADING_RE.test(name) ||
    STRONG_TAGS.has(name) ||
    EM_TAGS.has(name) ||
    STRIP_TAGS.has(name) ||
    name === 'li' ||
    name === 'br' ||
    name === 'a' ||
    name === 'code'
  );
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function readHref(attrs: string): string | null {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const raw = m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
  const href = decodeEntities(raw).trim();
  return SAFE_HREF.test(href) ? href : null;
}

function hasKnownTag(parts: string[]): boolean {
  for (let i = 0; i < parts.length; i += 2) {
    for (const m of parts[i]!.matchAll(TAG_RE)) {
      if (isKnownTag(m[2]!.toLowerCase())) return true;
    }
  }
  return false;
}

interface ListFrame {
  ordered: boolean;
  counter: number;
  indent: string;
  markerWidth: number;
}

class MarkdownBuilder {
  private out = '';
  private pendingBreak = 0;
  private pendingOpen = '';
  private skipLeadingSpace = false;
  private readonly lists: ListFrame[] = [];
  private readonly links: { start: number; href: string | null }[] = [];

  text(raw: string): void {
    let s = this.lists.length > 0 ? raw.replace(/\s*\n\s*/g, ' ') : raw;
    if (this.pendingBreak > 0 || this.pendingOpen || this.skipLeadingSpace) s = s.replace(/^\s+/, '');
    if (!s) return;
    this.flush();
    this.out += s;
    this.skipLeadingSpace = false;
  }

  get inList(): boolean {
    return this.lists.length > 0;
  }

  verbatim(s: string): void {
    this.flush();
    this.out += s;
  }

  block(newlines: number): void {
    this.trimEnd();
    this.pendingOpen = '';
    this.pendingBreak = Math.max(this.pendingBreak, newlines);
  }

  lineBreak(): void {
    if (this.lists.length > 0) {
      this.trimEnd();
      this.out += ' ';
      return;
    }
    this.trimEnd();
    this.pendingBreak = Math.min(this.pendingBreak + 1, 2);
  }

  open(marker: string): void {
    this.pendingOpen += marker;
  }

  close(marker: string): void {
    if (this.pendingOpen.endsWith(marker)) {
      this.pendingOpen = this.pendingOpen.slice(0, -marker.length);
      return;
    }
    const trailing = /\s*$/.exec(this.out)![0];
    this.out = this.out.slice(0, this.out.length - trailing.length) + marker + trailing;
  }

  openList(ordered: boolean): void {
    const parent = this.lists.at(-1);
    if (!parent) this.block(2);
    this.lists.push({
      ordered,
      counter: 0,
      indent: parent ? parent.indent + ' '.repeat(parent.markerWidth) : '',
      markerWidth: 0,
    });
  }

  closeList(): void {
    this.lists.pop();
    this.block(this.lists.length === 0 ? 2 : 1);
  }

  listItem(): void {
    const frame = this.lists.at(-1);
    if (!frame) {
      this.block(1);
      this.verbatim('- ');
      this.skipLeadingSpace = true;
      return;
    }
    frame.counter += 1;
    const marker = frame.ordered ? `${frame.counter}. ` : '- ';
    frame.markerWidth = marker.length;
    this.block(1);
    this.verbatim(frame.indent + marker);
    this.skipLeadingSpace = true;
  }

  openLink(href: string | null): void {
    this.flush();
    this.links.push({ start: this.out.length, href });
  }

  closeLink(): void {
    const link = this.links.pop();
    if (!link) return;
    const label = this.out.slice(link.start).trim();
    this.out = this.out.slice(0, link.start);
    if (!link.href) this.out += label;
    else if (!label || label === link.href || `mailto:${label}` === link.href) this.out += link.href;
    else this.out += `[${label}](${link.href})`;
  }

  result(): string {
    return this.out
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private flush(): void {
    if (this.pendingBreak > 0 && this.out.length > 0) {
      this.out += '\n'.repeat(this.pendingBreak);
    }
    this.pendingBreak = 0;
    this.out += this.pendingOpen;
    this.pendingOpen = '';
  }

  private trimEnd(): void {
    this.out = this.out.replace(/\s+$/, '');
  }
}

function convertSegment(b: MarkdownBuilder, segment: string): void {
  let last = 0;
  for (const m of segment.matchAll(TAG_RE)) {
    const [whole, slash, rawName, attrs] = m;
    const name = rawName!.toLowerCase();
    if (!isKnownTag(name)) continue;
    b.text(decodeEntities(segment.slice(last, m.index)));
    last = m.index + whole.length;
    const closing = slash === '/';

    if (name === 'br' || ((PARAGRAPH_TAGS.has(name) || LINE_TAGS.has(name)) && b.inList)) b.lineBreak();
    else if (PARAGRAPH_TAGS.has(name)) b.block(2);
    else if (LINE_TAGS.has(name)) b.block(1);
    else if (LIST_TAGS.has(name)) {
      if (closing) b.closeList();
      else b.openList(name === 'ol');
    } else if (name === 'li') {
      if (!closing) b.listItem();
    } else if (HEADING_RE.test(name)) {
      if (closing) {
        b.close('**');
        b.block(2);
      } else {
        b.block(2);
        b.open('**');
      }
    } else if (STRONG_TAGS.has(name)) {
      if (closing) b.close('**');
      else b.open('**');
    } else if (EM_TAGS.has(name)) {
      if (closing) b.close('*');
      else b.open('*');
    } else if (name === 'code') {
      b.verbatim('`');
    } else if (name === 'a') {
      if (closing) b.closeLink();
      else b.openLink(readHref(attrs ?? ''));
    }
  }
  b.text(decodeEntities(segment.slice(last)));
}

export function htmlToMarkdown(source: string): string {
  const parts = source.split(CODE_RE);
  if (!hasKnownTag(parts)) return source;
  const b = new MarkdownBuilder();
  parts.forEach((part, i) => {
    if (i % 2 === 1) b.verbatim(part);
    else convertSegment(b, part);
  });
  return b.result();
}
