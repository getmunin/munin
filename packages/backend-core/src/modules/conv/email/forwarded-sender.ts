import type { ParsedInboundEmail } from './threading.ts';

export type ForwardKind = 'direct' | 'auto-forward' | 'manual-forward';

export interface ForwardOrigin {
  kind: ForwardKind;
  senderAddress: string;
  senderName: string | null;
  forwardedBy: string | null;
}

const FORWARD_MARKERS: RegExp[] = [
  /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*videresendt melding\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*opprinnelig melding\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*vidarebefordrat meddelande\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*weitergeleitete nachricht\s*-{2,}\s*$/i,
  /^\s*begin forwarded message:\s*$/i,
  /^\s*videresendt melding:\s*$/i,
  /^\s*_{10,}\s*$/,
];

const FROM_LABELS = ['from', 'fra', 'von', 'de', 'från', 'da'];

const FORWARD_SUBJECT_PREFIX = /^\s*(fwd?|vs|vb|vidsend|wg|tr|rv|enc)\s*:/i;

const SCAN_LINES_AFTER_MARKER = 12;
const MAX_SCANNED_LINES = 400;

export function resolveForwardOrigin(
  parsed: ParsedInboundEmail,
  relayAddress: string,
): ForwardOrigin {
  const manual = parseManualForward(parsed.bodyText, parsed.subject);
  if (manual && manual.address !== parsed.fromAddress) {
    return {
      kind: 'manual-forward',
      senderAddress: manual.address,
      senderName: manual.name,
      forwardedBy: parsed.fromAddress || null,
    };
  }

  const hop = detectAutoForwardHop(parsed, relayAddress);
  if (hop) {
    return {
      kind: 'auto-forward',
      senderAddress: parsed.fromAddress,
      senderName: parsed.fromName,
      forwardedBy: hop,
    };
  }

  return {
    kind: 'direct',
    senderAddress: parsed.fromAddress,
    senderName: parsed.fromName,
    forwardedBy: null,
  };
}

export function parseManualForward(
  bodyText: string,
  subject: string,
): { address: string; name: string | null } | null {
  if (!bodyText) return null;
  const lines = bodyText.split(/\r?\n/, MAX_SCANNED_LINES);

  for (let i = 0; i < lines.length; i += 1) {
    if (!FORWARD_MARKERS.some((re) => re.test(lines[i]!))) continue;
    const found = scanForFromLine(lines, i + 1, i + 1 + SCAN_LINES_AFTER_MARKER);
    if (found) return found;
  }

  if (FORWARD_SUBJECT_PREFIX.test(subject)) {
    const found = scanForFromLine(lines, 0, Math.min(lines.length, MAX_SCANNED_LINES));
    if (found) return found;
  }

  return null;
}

function scanForFromLine(
  lines: string[],
  start: number,
  end: number,
): { address: string; name: string | null } | null {
  for (let i = start; i < Math.min(end, lines.length); i += 1) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    if (colon < 1 || colon > 20) continue;
    const label = line
      .slice(0, colon)
      .replace(/^[\s>*]+/, '')
      .trim()
      .toLowerCase();
    if (!FROM_LABELS.includes(label)) continue;
    const parsed = parseAddressLine(line.slice(colon + 1));
    if (parsed) return parsed;
  }
  return null;
}

export function parseAddressLine(value: string): { address: string; name: string | null } | null {
  const cleaned = value.replace(/\bmailto:/gi, '').trim();
  const angled = cleaned.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (angled) {
    const name = cleaned
      .slice(0, angled.index)
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    return { address: angled[1]!.toLowerCase(), name: name || null };
  }
  const bare = cleaned.match(/([^\s<>@,;"']+@[^\s<>@,;"']+\.[^\s<>@,;"']+)/);
  if (bare) return { address: bare[1]!.toLowerCase(), name: null };
  return null;
}

function detectAutoForwardHop(parsed: ParsedInboundEmail, relayAddress: string): string | null {
  const relay = relayAddress.trim().toLowerCase();

  for (const value of parsed.forwardedFor) {
    const first = value.split(/[\s,;]+/).find((token) => token.includes('@'));
    if (!first) continue;
    const address = first.replace(/[<>]/g, '').toLowerCase();
    if (address && address !== relay) return address;
  }

  const addressed = parsed.recipients
    .map((r) => parseAddressLine(r)?.address)
    .filter((a): a is string => !!a);
  const directlyAddressed = addressed.includes(relay);

  if (!directlyAddressed && addressed.length > 0) {
    const other = addressed.find((a) => a !== relay);
    if (other) return other;
  }

  if (parsed.forwardedTo.some((t) => t.toLowerCase().includes(relay))) {
    const other = addressed.find((a) => a !== relay);
    return other ?? relay;
  }

  return null;
}
