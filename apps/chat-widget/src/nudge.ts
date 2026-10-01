const SNOOZE_PREFIX = 'munin-widget-nudge-snoozed:';
export const NUDGE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const memory = new Map<string, number>();

export function isNudgeSnoozed(channelId: string, now: number = Date.now()): boolean {
  const at = memory.get(channelId) ?? readStoredAt(channelId);
  if (at === null) return false;
  return now - at < NUDGE_SNOOZE_MS;
}

export function snoozeNudge(channelId: string, now: number = Date.now()): void {
  memory.set(channelId, now);
  try {
    localStorage.setItem(SNOOZE_PREFIX + channelId, String(now));
  } catch {
    return;
  }
}

function readStoredAt(channelId: string): number | null {
  try {
    const raw = localStorage.getItem(SNOOZE_PREFIX + channelId);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
