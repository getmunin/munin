export interface MergeEvidence {
  matchSentence: string | null;
  keeperReason: string | null;
  signals: string[];
}

const KEEPER_REASON_KEYS = ['keeperReason', 'keeperRationale', 'whyKeeper'];

const SIGNAL_LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /^same_?email$/i, label: 'same email' },
  { match: /^email/i, label: 'alias of the same email' },
  { match: /^same_?phone/i, label: 'same phone' },
  { match: /^phone/i, label: 'same phone' },
  { match: /^same_?name$/i, label: 'same name' },
  { match: /^name/i, label: 'near-identical name' },
  { match: /^same_?company_?domain$/i, label: 'same company domain' },
  { match: /^same_?company/i, label: 'same company' },
  { match: /^company/i, label: 'same company' },
  { match: /^same_?title/i, label: 'same role' },
  { match: /^title/i, label: 'same role' },
];

export function readMergeEvidence(
  evidence: Record<string, unknown> | undefined,
): MergeEvidence {
  if (!evidence) return { matchSentence: null, keeperReason: null, signals: [] };

  let keeperReason: string | null = null;
  const signals: string[] = [];

  for (const [key, raw] of Object.entries(evidence)) {
    if (KEEPER_REASON_KEYS.includes(key)) {
      if (typeof raw === 'string' && raw.trim()) keeperReason = trimSentence(raw);
      continue;
    }
    const label = SIGNAL_LABELS.find((entry) => entry.match.test(key))?.label;
    if (label && !signals.includes(label)) signals.push(label);
  }

  return {
    matchSentence: signals.length > 0 ? `${sentenceCase(joinList(signals))}.` : null,
    keeperReason,
    signals,
  };
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function sentenceCase(text: string): string {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function trimSentence(text: string): string {
  return text.trim().replace(/[.!]+$/, '');
}
