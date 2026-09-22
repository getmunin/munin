export type EmailAuthVerdict = 'pass' | 'fail' | 'unknown';

export function stripAuthResultComments(value: string): string {
  let depth = 0;
  let out = '';
  for (const ch of value) {
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
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

  const cleaned = stripAuthResultComments(topmost);
  const dmarc = /\bdmarc\s*=\s*([a-z]+)/i.exec(cleaned)?.[1]?.toLowerCase();
  if (!dmarc) return 'unknown';
  if (dmarc !== 'pass') return 'fail';

  const fromDomain = emailDomain(args.fromAddress);
  if (!fromDomain) return 'fail';

  const headerFrom = /\bheader\.from\s*=\s*"?([^\s;"]+)"?/i.exec(cleaned)?.[1]?.toLowerCase();
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
