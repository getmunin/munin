import type { SetupReviewQueue } from '../first-run/setup-snapshot';
import { withinDecidedWindow } from './decided-window';
import type { CmsTranslationDto, QueueItem } from './queue-panes/types';

export type KbQueueItem = QueueItem & { kind: 'kb' };
export type CmsQueueItem = QueueItem & { kind: 'cms' };

export interface ReviewGroup {
  groupId: string;
  lead: CmsTranslationDto;
  leadIsViewerLanguage: boolean;
  translations: CmsTranslationDto[];
  members: CmsQueueItem[];
}

export type ReviewListEntry =
  | { type: 'single'; item: QueueItem }
  | { type: 'group'; group: ReviewGroup };

export interface ReviewPartition {
  blocking: QueueItem[];
  improvements: KbQueueItem[];
}

function millis(iso: string): number {
  const parsed = new Date(iso).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function partitionReviewQueue(queue: QueueItem[]): ReviewPartition {
  const blocking: QueueItem[] = [];
  const improvements: KbQueueItem[] = [];
  for (const item of queue) {
    if (item.kind === 'kb') improvements.push(item);
    else blocking.push(item);
  }
  blocking.sort((a, b) => millis(a.createdAt) - millis(b.createdAt));
  improvements.sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  return { blocking, improvements };
}

export function resolveReviewFirstRun(
  setupQueue: SetupReviewQueue | null,
  list: { loaded: boolean; empty: boolean },
  now = Date.now(),
): boolean | null {
  if (list.loaded) return list.empty;
  if (!setupQueue || setupQueue.hasPendingItems) return null;
  const { lastDecisionAt } = setupQueue;
  if (lastDecisionAt !== null && withinDecidedWindow(lastDecisionAt, now)) return null;
  return true;
}

export type ReviewDecisionOutcome = 'approved' | 'dismissed' | 'scheduled';

export function nextAfterDecision(ids: readonly string[], decidedId: string): string | null {
  const index = ids.indexOf(decidedId);
  if (index < 0) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

function primaryLanguage(locale: string): string {
  const primary = locale.toLowerCase().split(/[-_]/)[0] ?? '';
  return primary === 'no' ? 'nb' : primary;
}

export function isViewerLanguage(entryLocale: string, viewerLocale: string): boolean {
  return primaryLanguage(entryLocale) === primaryLanguage(viewerLocale);
}

export function pickLeadTranslation(
  translations: readonly CmsTranslationDto[],
  viewerLocale: string,
): CmsTranslationDto | null {
  const viewer = viewerLocale.toLowerCase();
  return (
    translations.find((t) => t.locale.toLowerCase() === viewer) ??
    translations.find((t) => isViewerLanguage(t.locale, viewerLocale)) ??
    translations.find((t) => t.isDefaultLocale) ??
    translations[0] ??
    null
  );
}

function translationGroupOf(item: QueueItem): string | null {
  if (item.kind !== 'cms') return null;
  const { translationGroupId, translations } = item.raw;
  if (!translationGroupId || !translations || translations.length < 2) return null;
  return translationGroupId;
}

export function groupReviewQueue(
  items: readonly QueueItem[],
  viewerLocale: string,
): ReviewListEntry[] {
  const membersByGroup = new Map<string, CmsQueueItem[]>();
  for (const item of items) {
    const groupId = translationGroupOf(item);
    if (!groupId || item.kind !== 'cms') continue;
    membersByGroup.set(groupId, [...(membersByGroup.get(groupId) ?? []), item]);
  }

  const entries: ReviewListEntry[] = [];
  const emitted = new Set<string>();
  for (const item of items) {
    const groupId = translationGroupOf(item);
    if (!groupId || item.kind !== 'cms') {
      entries.push({ type: 'single', item });
      continue;
    }
    if (emitted.has(groupId)) continue;
    emitted.add(groupId);

    const siblings = item.raw.translations ?? [];
    const lead = pickLeadTranslation(siblings, viewerLocale);
    if (!lead) {
      entries.push({ type: 'single', item });
      continue;
    }
    const translations = [lead, ...siblings.filter((t) => t.id !== lead.id)];
    const waiting = new Map((membersByGroup.get(groupId) ?? []).map((m) => [m.id, m]));
    const members = translations.flatMap((t) => {
      const member = waiting.get(t.id);
      return member ? [member] : [];
    });
    entries.push({
      type: 'group',
      group: {
        groupId,
        lead,
        leadIsViewerLanguage: isViewerLanguage(lead.locale, viewerLocale),
        translations,
        members,
      },
    });
  }
  return entries;
}

export function reviewEntryIds(entries: readonly ReviewListEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.type === 'group' ? entry.group.members.map((m) => m.id) : [entry.item.id],
  );
}

export function countReviewDecisions(
  items: ReadonlyArray<{ kind: string; id: string; raw: unknown }>,
): number {
  const keys = new Set<string>();
  for (const item of items) {
    const raw = item.raw as { translationGroupId?: unknown; translations?: unknown } | null;
    const grouped =
      item.kind === 'cms' &&
      raw !== null &&
      typeof raw === 'object' &&
      typeof raw.translationGroupId === 'string' &&
      Array.isArray(raw.translations) &&
      raw.translations.length > 1;
    keys.add(grouped ? `group:${String(raw.translationGroupId)}` : `${item.kind}:${item.id}`);
  }
  return keys.size;
}

export function nextAfterDecisions(
  ids: readonly string[],
  decidedIds: readonly string[],
): string | null {
  const decided = new Set(decidedIds);
  const positions = ids.flatMap((id, index) => (decided.has(id) ? [index] : []));
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first === undefined || last === undefined) return null;
  for (let i = last + 1; i < ids.length; i += 1) {
    const id = ids[i];
    if (id !== undefined && !decided.has(id)) return id;
  }
  for (let i = first - 1; i >= 0; i -= 1) {
    const id = ids[i];
    if (id !== undefined && !decided.has(id)) return id;
  }
  return null;
}

export function nextWaitingSibling(
  memberIds: readonly string[],
  decidedId: string,
): string | null {
  const index = memberIds.indexOf(decidedId);
  if (index < 0 || memberIds.length < 2) return null;
  return memberIds[index + 1] ?? memberIds[0] ?? null;
}
