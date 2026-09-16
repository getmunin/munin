export const DECIDED_WINDOW_DAYS = 30;

export function withinDecidedWindow(decidedAt: string, now = Date.now()): boolean {
  return now - new Date(decidedAt).getTime() <= DECIDED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
