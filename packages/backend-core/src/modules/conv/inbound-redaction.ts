import {
  NATIONAL_ID_DETECTORS,
  countNationalIds,
  findNationalIds,
  redactNationalIds,
  type NationalIdConfidence,
  type NationalIdDetector,
  type NationalIdPolicy,
} from '@getmunin/core';

export interface InboundRedactionPolicy {
  detectors: readonly NationalIdDetector[];
  policy: NationalIdPolicy;
  minConfidence: NationalIdConfidence;
}

export const REDACTION_OFF: InboundRedactionPolicy = {
  detectors: [],
  policy: 'off',
  minConfidence: 'high',
};

export interface InboundTextFields {
  body: string;
  bodyHtml?: string | null;
  subject?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DetectedNationalId {
  detector: NationalIdDetector;
  confidence: NationalIdConfidence;
  count: number;
}

export interface InboundRedactionResult<T extends InboundTextFields> {
  fields: T;
  detected: DetectedNationalId[];
  redacted: boolean;
}

const REDACTED_METADATA_KEYS = ['preStripBody', 'signatureText', 'raw'] as const;

export function applyInboundRedaction<T extends InboundTextFields>(
  fields: T,
  policy: InboundRedactionPolicy,
): InboundRedactionResult<T> {
  const mutating = policy.policy !== 'off' && policy.detectors.length > 0;
  const enabled = new Set(policy.detectors);
  const detected: DetectedNationalId[] = [];
  let redacted = false;

  const rewrite = (text: string): string => {
    const matches = findNationalIds(text, NATIONAL_ID_DETECTORS, {
      minConfidence: policy.minConfidence,
    });
    if (matches.length === 0) return text;
    detected.push(...countNationalIds(matches));
    if (!mutating) return text;
    const mine = matches.filter((m) => enabled.has(m.detector));
    if (mine.length === 0) return text;
    redacted = true;
    return redactNationalIds(text, mine, policy.policy as Exclude<NationalIdPolicy, 'off'>);
  };

  const next = { ...fields };
  next.body = rewrite(fields.body);
  if (typeof fields.bodyHtml === 'string') next.bodyHtml = rewrite(fields.bodyHtml);
  if (typeof fields.subject === 'string') next.subject = rewrite(fields.subject);
  if (fields.metadata) next.metadata = rewriteMetadata(fields.metadata, rewrite);

  return { fields: next, detected: mergeDetections(detected), redacted };
}

export function hasDetections(detected: readonly DetectedNationalId[]): boolean {
  return detected.length > 0;
}

function rewriteMetadata(
  metadata: Record<string, unknown>,
  rewrite: (text: string) => string,
): Record<string, unknown> {
  const next = { ...metadata };
  for (const key of REDACTED_METADATA_KEYS) {
    const value = next[key];
    if (typeof value === 'string') next[key] = rewrite(value);
  }
  const quoted: unknown = next.quotedThread;
  if (Array.isArray(quoted)) {
    next.quotedThread = (quoted as unknown[]).map((turn): unknown => {
      if (typeof turn !== 'object' || turn === null) return turn;
      const record = turn as Record<string, unknown>;
      const patched: Record<string, unknown> = { ...record };
      if (typeof record.body === 'string') patched.body = rewrite(record.body);
      if (typeof record.subject === 'string') patched.subject = rewrite(record.subject);
      return patched;
    });
  }
  return next;
}

function mergeDetections(detected: DetectedNationalId[]): DetectedNationalId[] {
  const buckets = new Map<string, DetectedNationalId>();
  for (const entry of detected) {
    const key = `${entry.detector}:${entry.confidence}`;
    const existing = buckets.get(key);
    if (existing) existing.count += entry.count;
    else buckets.set(key, { ...entry });
  }
  return [...buckets.values()];
}
