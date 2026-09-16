import { fenceUntrusted } from './untrusted.ts';

export interface QuotedHistoryTurn {
  from: string | null;
  date: string | null;
  subject: string | null;
  body: string;
}

export const MAX_QUOTED_HISTORY_TURNS = 2;
export const MAX_QUOTED_HISTORY_TURN_CHARS = 1_000;
export const MAX_QUOTED_HISTORY_SUMMARY_CHARS = 400;

export const QUOTED_HISTORY_LABEL =
  '[Quoted email history — text the mail client quoted, not what the customer wrote]';

export function readQuotedHistory(
  metadata: Record<string, unknown> | null | undefined,
): QuotedHistoryTurn[] {
  const raw = metadata?.['quotedThread'];
  if (!Array.isArray(raw)) return [];
  const turns: QuotedHistoryTurn[] = [];
  for (const item of raw) {
    if (turns.length >= MAX_QUOTED_HISTORY_TURNS) break;
    if (typeof item !== 'object' || item === null) continue;
    const turn = item as Record<string, unknown>;
    const body = typeof turn.body === 'string' ? turn.body.trim() : '';
    if (body.length === 0) continue;
    turns.push({
      from: stringOrNull(turn.from),
      date: stringOrNull(turn.date),
      subject: stringOrNull(turn.subject),
      body: truncate(body, MAX_QUOTED_HISTORY_TURN_CHARS),
    });
  }
  return turns;
}

export function renderQuotedHistory(turns: readonly QuotedHistoryTurn[]): string | null {
  if (turns.length === 0) return null;
  const blocks = turns.map((turn, index) => {
    const header = [
      `--- quoted message ${index + 1}${index === 0 ? ' (most recent)' : ''} ---`,
      turn.from ? `From: ${turn.from}` : null,
      turn.date ? `Date: ${turn.date}` : null,
      turn.subject ? `Subject: ${turn.subject}` : null,
    ].filter((line): line is string => line !== null);
    return `${header.join('\n')}\n\n${turn.body}`;
  });
  return `${QUOTED_HISTORY_LABEL}\n${fenceUntrusted('quoted_history', blocks.join('\n\n'))}`;
}

export function summarizeQuotedHistory(turns: readonly QuotedHistoryTurn[]): string | null {
  if (turns.length === 0) return null;
  const lines = turns.map((turn) => {
    const who = [turn.from, turn.date].filter((part) => part).join(' · ');
    const body = truncate(turn.body.replace(/\s+/g, ' ').trim(), MAX_QUOTED_HISTORY_SUMMARY_CHARS);
    return who ? `${who}: ${body}` : body;
  });
  return `(quoted email the customer replied to, not their words) ${lines.join(' | ')}`;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
