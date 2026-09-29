const MARKUP_PATTERN = /\[\[([\s\S]+?)\]\]|\{\{([\s\S]+?)\}\}/g;
const STRAY_MARKERS = /\[\[|\]\]|\{\{|\}\}/g;

export interface ParsedDraft {
  body: string;
  annotated: string | null;
  slots: string[];
}

export function parseDraftMarkup(raw: string): ParsedDraft {
  const slots: string[] = [];
  let sawMarkup = false;
  const replaced = raw.replace(MARKUP_PATTERN, (_match, added?: string, slot?: string) => {
    sawMarkup = true;
    if (added !== undefined) return added;
    const token = `[${slot!.trim()}]`;
    if (!slots.includes(token)) slots.push(token);
    return token;
  });
  const body = replaced.replace(STRAY_MARKERS, '');
  return {
    body,
    annotated: sawMarkup ? raw : null,
    slots,
  };
}

export function openDraftSlots(slots: readonly string[], sentBody: string): string[] {
  return slots.filter((slot) => sentBody.includes(slot));
}
