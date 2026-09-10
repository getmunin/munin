export const MAX_INBOUND_BODY_CHARS = 24_000;

const ENCODED_RUN = /[A-Za-z0-9+/=_-]{60,}/;
const MIN_ENCODED_LINES = 3;
const MAX_INLINE_TOKEN_CHARS = 400;

export function clampInboundBody(body: string): string {
  return truncate(collapseEncodedBlocks(body));
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
