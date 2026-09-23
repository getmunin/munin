export type EmailAuthVerdict = 'pass' | 'fail' | 'unknown';

export interface AuthResultInfo {
  method: string;
  result: string;
  props: Record<string, string>;
}

export interface ParsedAuthenticationResults {
  authservId: string;
  results: AuthResultInfo[];
}

export function stripAuthResultComments(value: string): string {
  let depth = 0;
  let inQuote = false;
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (inQuote) {
      out += ch;
      if (ch === '\\' && i + 1 < value.length) {
        out += value[i + 1];
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (depth > 0) {
      if (ch === '\\') i += 1;
      else if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      continue;
    }
    if (ch === '(') {
      depth = 1;
      continue;
    }
    if (ch === ')') continue;
    if (ch === '"') inQuote = true;
    out += ch;
  }
  return out;
}

function splitOutsideQuotes(value: string, isSeparator: (ch: string) => boolean): string[] {
  const parts: string[] = [];
  let inQuote = false;
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (inQuote) {
      current += ch;
      if (ch === '\\' && i + 1 < value.length) {
        current += value[i + 1];
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      current += ch;
      continue;
    }
    if (isSeparator(ch)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return value;
}

const METHOD_SPEC = /^([a-z0-9][a-z0-9_-]*)(?:\/[0-9]+)?=([a-z0-9_-]+)$/i;
const PROP_SPEC = /^([a-z0-9_-]+(?:\.[a-z0-9_.-]+)?)=(.*)$/i;

export function parseAuthenticationResults(header: string): ParsedAuthenticationResults | null {
  const segments = splitOutsideQuotes(stripAuthResultComments(header), (ch) => ch === ';');
  const authservId = segments[0]?.trim().split(/\s+/)[0] ?? '';
  if (!authservId) return null;
  const results: AuthResultInfo[] = [];
  for (const segment of segments.slice(1)) {
    const tokens = splitOutsideQuotes(segment.trim(), (ch) => /\s/.test(ch)).filter(Boolean);
    if (tokens.length === 0) continue;
    const spec = METHOD_SPEC.exec(tokens[0]!);
    if (!spec) continue;
    const props: Record<string, string> = {};
    for (const token of tokens.slice(1)) {
      const prop = PROP_SPEC.exec(token);
      if (!prop) continue;
      const key = prop[1]!.toLowerCase();
      if (!(key in props)) props[key] = unquote(prop[2]!);
    }
    results.push({
      method: spec[1]!.toLowerCase(),
      result: spec[2]!.toLowerCase(),
      props,
    });
  }
  return { authservId, results };
}

export function emailDomain(address: string | null | undefined): string | null {
  const at = (address ?? '').trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return null;
  const domain = address!.trim().toLowerCase().slice(at + 1).replace(/[>\s]+$/, '');
  const cleaned = domain.replace(/\.$/, '');
  return cleaned || null;
}

export function evaluateInboundEmailAuth(args: {
  authenticationResults: readonly string[];
  fromAddress: string | null;
}): EmailAuthVerdict {
  const topmost = args.authenticationResults[0];
  if (!topmost) return 'unknown';

  const parsed = parseAuthenticationResults(topmost);
  if (!parsed) return 'unknown';

  const dmarc = parsed.results.filter((r) => r.method === 'dmarc');
  if (dmarc.length === 0) return 'unknown';
  if (dmarc.length > 1) return 'fail';
  const only = dmarc[0]!;
  if (only.result === 'fail') return 'fail';
  if (only.result !== 'pass') return 'unknown';

  const fromDomain = emailDomain(args.fromAddress);
  if (!fromDomain) return 'fail';

  const headerFrom = only.props['header.from']?.trim().toLowerCase();
  if (!headerFrom) return 'unknown';

  const asserted = headerFrom.replace(/\.$/, '');
  return asserted === fromDomain ? 'pass' : 'fail';
}

export function inboundSenderAuth(
  parsed: { authenticationResults: readonly string[]; fromAddress: string | null },
  sender: { kind: string; senderAddress: string },
): EmailAuthVerdict {
  if (sender.kind !== 'direct') return 'unknown';
  const claimed = sender.senderAddress.trim().toLowerCase();
  const envelope = (parsed.fromAddress ?? '').trim().toLowerCase();
  if (!claimed || claimed !== envelope) return 'unknown';
  return evaluateInboundEmailAuth({
    authenticationResults: parsed.authenticationResults,
    fromAddress: parsed.fromAddress,
  });
}
