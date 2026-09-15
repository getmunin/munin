import { senderDisplayName } from './sender-name.ts';
import { CC_LABELS, FROM_LABELS, TO_LABELS } from './header-labels.ts';
import type { ParsedInboundEmail } from './threading.ts';

export type ForwardKind = 'direct' | 'auto-forward' | 'manual-forward';

export interface ForwardOrigin {
  kind: ForwardKind;
  senderAddress: string;
  senderName: string | null;
  forwardedBy: string | null;
}

export interface ManualForwardBlock {
  address: string;
  name: string | null;
  recipients: string[];
}

export type ForwardMarkerKind = 'declared' | 'ambiguous';

const DECLARED_FORWARD_MARKERS: RegExp[] = [
  /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*videresendt melding\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*vidarebefordrat meddelande\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*weitergeleitete nachricht\s*-{2,}\s*$/i,
  /^\s*begin forwarded message:\s*$/i,
  /^\s*videresendt melding:\s*$/i,
];

const AMBIGUOUS_FORWARD_MARKERS: RegExp[] = [
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*opprinnelig melding\s*-{2,}\s*$/i,
  /^\s*_{10,}\s*$/,
];

export const FORWARD_MARKERS: RegExp[] = [
  ...DECLARED_FORWARD_MARKERS,
  ...AMBIGUOUS_FORWARD_MARKERS,
];

export function forwardMarkerKind(line: string): ForwardMarkerKind | null {
  if (DECLARED_FORWARD_MARKERS.some((re) => re.test(line))) return 'declared';
  if (AMBIGUOUS_FORWARD_MARKERS.some((re) => re.test(line))) return 'ambiguous';
  return null;
}

const FORWARD_SUBJECT_PREFIX = /^\s*(fwd?|vs|vb|vidsend|wg|tr|rv|enc)\s*:/i;

export function subjectDeclaresForward(subject: string | null | undefined): boolean {
  return FORWARD_SUBJECT_PREFIX.test(subject ?? '');
}

const SCAN_LINES_AFTER_MARKER = 12;
const MAX_SCANNED_LINES = 400;
const RECIPIENT_LINES_AFTER_FROM = 6;
const MAX_LABEL_CHARS = 20;

export function resolveForwardOrigin(
  parsed: ParsedInboundEmail,
  relayAddress: string,
  ownAddresses: readonly string[] = [],
): ForwardOrigin {
  const manual = parseManualForward(parsed.bodyText, parsed.subject);
  if (manual && isForwardedSender(manual, parsed.fromAddress, relayAddress, ownAddresses)) {
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

function isForwardedSender(
  manual: ManualForwardBlock,
  envelopeFrom: string,
  relayAddress: string,
  ownAddresses: readonly string[],
): boolean {
  const sender = normalise(envelopeFrom);
  if (!sender) return false;
  if (manual.address === sender) return false;
  if (manual.recipients.includes(sender)) return false;
  const ours = new Set(
    [relayAddress, ...ownAddresses].map(normalise).filter((a): a is string => a !== null),
  );
  return !ours.has(manual.address);
}

function normalise(address: string | null | undefined): string | null {
  const trimmed = address?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function parseManualForward(
  bodyText: string,
  subject: string,
): ManualForwardBlock | null {
  if (!bodyText) return null;
  const lines = bodyText.split(/\r?\n/, MAX_SCANNED_LINES);

  for (let i = 0; i < lines.length; i += 1) {
    if (!FORWARD_MARKERS.some((re) => re.test(lines[i]!))) continue;
    const found = scanForHeaderBlock(lines, i + 1, i + 1 + SCAN_LINES_AFTER_MARKER);
    if (found) return found;
  }

  if (FORWARD_SUBJECT_PREFIX.test(subject)) {
    const found = scanForHeaderBlock(lines, 0, Math.min(lines.length, MAX_SCANNED_LINES));
    if (found) return found;
  }

  return null;
}

function scanForHeaderBlock(
  lines: string[],
  start: number,
  end: number,
): ManualForwardBlock | null {
  for (let i = start; i < Math.min(end, lines.length); i += 1) {
    const value = labelledValue(lines[i]!, FROM_LABELS);
    if (value === null) continue;
    const sender = parseAddressLine(value);
    if (!sender) continue;
    return {
      address: sender.address,
      name: sender.name,
      recipients: collectRecipients(lines, i + 1, i + 1 + RECIPIENT_LINES_AFTER_FROM),
    };
  }
  return null;
}

function collectRecipients(lines: string[], start: number, end: number): string[] {
  const out: string[] = [];
  for (let i = start; i < Math.min(end, lines.length); i += 1) {
    const value =
      labelledValue(lines[i]!, TO_LABELS) ?? labelledValue(lines[i]!, CC_LABELS);
    if (value === null) continue;
    out.push(...parseAddressList(value));
  }
  return out;
}

function labelledValue(line: string, labels: readonly string[]): string | null {
  const colon = line.indexOf(':');
  if (colon < 1 || colon > MAX_LABEL_CHARS) return null;
  const label = line
    .slice(0, colon)
    .replace(/^[\s>*]+/, '')
    .trim()
    .toLowerCase();
  if (!labels.includes(label)) return null;
  const value = line.slice(colon + 1).trim();
  return value.length > 0 ? value : null;
}

export function parseAddressList(value: string): string[] {
  const cleaned = value.replace(/\bmailto:/gi, '');
  const out: string[] = [];
  for (const match of cleaned.matchAll(/([^\s<>@,;"']+@[^\s<>@,;"']+\.[^\s<>@,;"']+)/g)) {
    out.push(match[1]!.toLowerCase());
  }
  return out;
}

export function parseAddressLine(value: string): { address: string; name: string | null } | null {
  const cleaned = value.replace(/\bmailto:/gi, '').trim();
  const angled = cleaned.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (angled) {
    const name = cleaned
      .slice(0, angled.index)
      .trim()
      .replace(/^["']|["']$/g, '');
    return { address: angled[1]!.toLowerCase(), name: senderDisplayName(name) };
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
