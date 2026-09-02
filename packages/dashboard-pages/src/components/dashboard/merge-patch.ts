import type { CrmContactSummary } from './queue-drawers/types';

export type MergeFieldKind = 'differs' | 'replaced' | 'added';

export interface MergeFieldChange {
  field: string;
  kind: MergeFieldKind;
  before: string | null;
  after: string;
  dropped: string[];
}

const REPLACED_WHOLESALE = new Set(['tags', 'customFields']);

const COMPARABLE_FIELDS = [
  'name',
  'email',
  'phone',
  'title',
  'address',
  'companyName',
  'tags',
  'customFields',
  'aiSummary',
  'aiNextAction',
  'engagementScore',
  'doNotContact',
  'consentLawfulBasis',
  'consentSource',
  'lastContactedAt',
] as const;

export function comparableFieldCount(): number {
  return COMPARABLE_FIELDS.length;
}

export function mergePatchChanges(
  keeper: CrmContactSummary,
  patch: Record<string, unknown> | undefined,
): MergeFieldChange[] {
  if (!patch) return [];
  const out: MergeFieldChange[] = [];
  for (const [field, raw] of Object.entries(patch)) {
    const after = formatFieldValue(raw);
    if (after === null) continue;
    const before = formatFieldValue((keeper as unknown as Record<string, unknown>)[field]);
    if (before === after) continue;
    const kind: MergeFieldKind =
      before === null ? 'added' : REPLACED_WHOLESALE.has(field) ? 'replaced' : 'differs';
    out.push({
      field,
      kind,
      before,
      after,
      dropped: kind === 'replaced' ? droppedParts(before, after) : [],
    });
  }
  return out.sort((a, b) => fieldRank(a.field) - fieldRank(b.field) || a.field.localeCompare(b.field));
}

function droppedParts(before: string | null, after: string): string[] {
  if (!before) return [];
  const kept = new Set(after.split(' · '));
  return before.split(' · ').filter((part) => !kept.has(part));
}

function fieldRank(field: string): number {
  const index = (COMPARABLE_FIELDS as readonly string[]).indexOf(field);
  return index === -1 ? COMPARABLE_FIELDS.length : index;
}

export function formatFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    const parts = value.flatMap((entry) => {
      const formatted = formatFieldValue(entry);
      return formatted === null ? [] : [formatted];
    });
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const formatted = formatFieldValue(v);
      return formatted === null ? [] : [`${k}: ${formatted}`];
    });
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  return null;
}
