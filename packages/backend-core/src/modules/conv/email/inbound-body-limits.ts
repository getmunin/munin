export const MAX_INBOUND_BODY_CHARS = 24_000;

const ENCODED_RUN = /[A-Za-z0-9+/=_-]{60,}/;
const MIN_ENCODED_LINES = 3;
const MAX_INLINE_TOKEN_CHARS = 400;

export function clampInboundBody(body: string): string {
  return truncate(collapseEncodedBlocks(body));
}

export function normalizeFlattenedWhitespace(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const indent = commonLeadingWhitespace(lines);
  const dedented = indent ? lines.map((l) => (l ? l.slice(indent.length) : l)) : lines;
  const out: string[] = [];
  let pendingBlank = false;
  for (const line of dedented) {
    if (line === '') {
      pendingBlank = out.length > 0;
      continue;
    }
    if (pendingBlank) out.push('');
    pendingBlank = false;
    out.push(line);
  }
  return out.join('\n');
}

function commonLeadingWhitespace(lines: string[]): string {
  let prefix: string | null = null;
  for (const line of lines) {
    if (line === '') continue;
    const leading = /^[ \t]*/.exec(line)![0];
    if (leading.length === 0) return '';
    if (prefix === null) {
      prefix = leading;
      continue;
    }
    let i = 0;
    while (i < prefix.length && i < leading.length && prefix[i] === leading[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) return '';
  }
  return prefix ?? '';
}

export function collapseEncodedBlocks(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let run: string[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    if (run.length >= MIN_ENCODED_LINES) {
      out.push(`[${run.length} lines of encoded data removed]`);
    } else {
      out.push(...run.map(collapseInlineToken));
    }
    run = [];
  };

  for (const line of lines) {
    if (isEncodedLine(line) || (run.length > 0 && isEncodedContinuation(line))) {
      run.push(line);
      continue;
    }
    flush();
    out.push(collapseInlineToken(line));
  }
  flush();
  return out.join('\n');
}

function isEncodedLine(line: string): boolean {
  const stripped = line.trim().replace(/^[A-Za-z0-9-]+:\s*/, '');
  if (stripped.length < 60) return false;
  const match = ENCODED_RUN.exec(stripped);
  return match !== null && match[0].length >= stripped.length * 0.9;
}

function isEncodedContinuation(line: string): boolean {
  const stripped = line.trim();
  if (stripped.length < 16) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(stripped)) return false;
  if (/[+/=]/.test(stripped)) return true;
  return /[a-z]/.test(stripped) && /[A-Z]/.test(stripped) && /[0-9]/.test(stripped);
}

function collapseInlineToken(line: string): string {
  if (line.length <= MAX_INLINE_TOKEN_CHARS) return line;
  return line.replace(
    new RegExp(`[A-Za-z0-9+/=_-]{${MAX_INLINE_TOKEN_CHARS},}`, 'g'),
    '[encoded data removed]',
  );
}

function truncate(body: string): string {
  if (body.length <= MAX_INBOUND_BODY_CHARS) return body;
  const kept = body.slice(0, MAX_INBOUND_BODY_CHARS);
  const removed = body.length - kept.length;
  return `${kept}\n\n[truncated — ${removed} more characters were not stored]`;
}
