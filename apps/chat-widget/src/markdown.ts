export function renderMarkdownInto(target: HTMLElement, source: string): void {
  while (target.firstChild) target.removeChild(target.firstChild);
  const text = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = splitBlocks(text);
  for (const block of blocks) {
    if (block.kind === 'code') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (block.language) code.setAttribute('data-language', block.language);
      code.textContent = block.text;
      pre.appendChild(code);
      target.appendChild(pre);
      continue;
    }
    if (block.kind === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        renderInline(li, item);
        list.appendChild(li);
      }
      target.appendChild(list);
      continue;
    }
    const p = document.createElement('p');
    renderInline(p, block.text);
    target.appendChild(p);
  }
}

interface ParaBlock { kind: 'para'; text: string; }
interface CodeBlock { kind: 'code'; text: string; language: string | null; }
interface ListBlock { kind: 'list'; ordered: boolean; items: string[]; }
type Block = ParaBlock | CodeBlock | ListBlock;

const UNORDERED_RE = /^[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\d+)[.)]\s+(.*)$/;

function splitBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fenceMatch = /^```(\S*)\s*$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] || null;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push({ kind: 'code', text: codeLines.join('\n'), language: lang });
      continue;
    }
    if (UNORDERED_RE.test(line) || ORDERED_RE.test(line)) {
      const ordered = ORDERED_RE.test(line);
      const items: string[] = [];
      const re = ordered ? ORDERED_RE : UNORDERED_RE;
      while (i < lines.length) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(ordered ? m[2]! : m[1]!);
        i += 1;
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^```/.test(lines[i]!) &&
      !UNORDERED_RE.test(lines[i]!) &&
      !ORDERED_RE.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i += 1;
    }
    out.push({ kind: 'para', text: paraLines.join('\n') });
  }
  return out;
}

function renderInline(target: HTMLElement, source: string): void {
  let buf = '';
  const flush = (): void => {
    if (buf) target.appendChild(document.createTextNode(buf));
    buf = '';
  };
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    if (ch === '\n') {
      flush();
      target.appendChild(document.createElement('br'));
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < n) {
      const next = source[i + 1]!;
      if ('*_`[\\'.includes(next)) {
        buf += next;
        i += 2;
        continue;
      }
    }
    if (ch === '*' && source[i + 1] === '*') {
      const end = findClosing(source, i + 2, '**');
      if (end !== -1) {
        flush();
        const node = document.createElement('strong');
        renderInline(node, source.slice(i + 2, end));
        target.appendChild(node);
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && source[i + 1] !== ch && !isWordBefore(source, i) && i + 1 < n && !/\s/.test(source[i + 1]!)) {
      const end = findClosing(source, i + 1, ch);
      if (end !== -1 && !/\s/.test(source[end - 1]!)) {
        flush();
        const node = document.createElement('em');
        renderInline(node, source.slice(i + 1, end));
        target.appendChild(node);
        i = end + 1;
        continue;
      }
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        const node = document.createElement('code');
        node.textContent = source.slice(i + 1, end);
        target.appendChild(node);
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const link = parseLink(source, i);
      if (link) {
        flush();
        const a = document.createElement('a');
        a.href = link.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        renderInline(a, link.text);
        target.appendChild(a);
        i = link.consumed;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
}

function findClosing(source: string, from: number, marker: string): number {
  const len = marker.length;
  for (let i = from; i <= source.length - len; i += 1) {
    if (source[i - 1] === '\\') continue;
    if (source.slice(i, i + len) === marker) {
      if (len === 1 && source[i + 1] === marker) continue;
      return i;
    }
  }
  return -1;
}

function isWordBefore(source: string, i: number): boolean {
  if (i === 0) return false;
  return /\w/.test(source[i - 1]!);
}

function parseLink(source: string, i: number): { text: string; href: string; consumed: number } | null {
  let j = i + 1;
  let depth = 1;
  while (j < source.length && depth > 0) {
    const c = source[j]!;
    if (c === '\\' && j + 1 < source.length) {
      j += 2;
      continue;
    }
    if (c === '[') depth += 1;
    else if (c === ']') depth -= 1;
    if (depth === 0) break;
    j += 1;
  }
  if (depth !== 0) return null;
  if (source[j + 1] !== '(') return null;
  const text = source.slice(i + 1, j);
  let k = j + 2;
  while (k < source.length && source[k] !== ')') {
    if (source[k] === '\n') return null;
    k += 1;
  }
  if (source[k] !== ')') return null;
  const rawUrl = source.slice(j + 2, k).trim();
  if (!isSafeUrl(rawUrl)) return null;
  return { text, href: rawUrl, consumed: k + 1 };
}

function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^mailto:/i.test(url) || url.startsWith('/');
}
