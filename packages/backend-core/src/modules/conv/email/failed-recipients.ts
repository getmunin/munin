const ADDRESS = /[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/;

export interface DeliveryStatusSource {
  headerLines: ReadonlyArray<{ key: string; line: string }>;
  deliveryStatusParts: readonly string[];
  bodyText: string;
}

export function extractFailedRecipients(source: DeliveryStatusSource): string[] {
  const out = new Set<string>();
  for (const line of source.headerLines) {
    if (line.key.toLowerCase() !== 'x-failed-recipients') continue;
    const value = line.line.split(':').slice(1).join(':');
    for (const part of value.split(',')) {
      const address = readAddress(part);
      if (address) out.add(address);
    }
  }
  const reports = source.deliveryStatusParts.length > 0
    ? source.deliveryStatusParts
    : [source.bodyText];
  for (const report of reports) {
    for (const address of failedRecipientsInReport(report)) out.add(address);
  }
  return [...out];
}

function failedRecipientsInReport(report: string): string[] {
  const out: string[] = [];
  for (const block of report.split(/\r?\n[ \t]*\r?\n/)) {
    if (!/^\s*(?:final|original)-recipient\s*:/im.test(block)) continue;
    const failed =
      /^\s*action\s*:\s*failed\b/im.test(block) ||
      (!/^\s*action\s*:/im.test(block) && /^\s*status\s*:\s*5\.\d+\.\d+/im.test(block));
    if (!failed) continue;
    const match =
      block.match(/^\s*final-recipient\s*:(.*)$/im) ??
      block.match(/^\s*original-recipient\s*:(.*)$/im);
    const address = readAddress(match?.[1]);
    if (address) out.push(address);
  }
  return out;
}

function readAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  const afterType = raw.includes(';') ? raw.slice(raw.indexOf(';') + 1) : raw;
  const match = afterType.match(ADDRESS);
  return match ? match[0].replace(/^[<"']+|[>"',;.]+$/g, '').toLowerCase() : null;
}
