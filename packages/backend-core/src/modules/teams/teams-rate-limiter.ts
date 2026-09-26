interface RateWindow {
  ms: number;
  max: number;
}

const TEAMS_CONVERSATION_WINDOWS: readonly RateWindow[] = [
  { ms: 1_000, max: 6 },
  { ms: 30_000, max: 55 },
  { ms: 3_600_000, max: 1_750 },
];

const MAX_TRACKED_KEYS = 5_000;

export class ConversationRateLimiter {
  private readonly sent = new Map<string, number[]>();

  constructor(private readonly windows: readonly RateWindow[] = TEAMS_CONVERSATION_WINDOWS) {}

  waitMs(key: string, now = Date.now()): number {
    const history = this.prune(key, now);
    let wait = 0;
    for (const window of this.windows) {
      const inWindow = history.filter((t) => t > now - window.ms);
      if (inWindow.length < window.max) continue;
      const oldestBlocking = inWindow[inWindow.length - window.max]!;
      wait = Math.max(wait, oldestBlocking + window.ms - now);
    }
    return wait;
  }

  record(key: string, now = Date.now()): void {
    const history = this.prune(key, now);
    history.push(now);
    this.sent.set(key, history);
    if (this.sent.size > MAX_TRACKED_KEYS) {
      const oldest = this.sent.keys().next().value;
      if (oldest !== undefined) this.sent.delete(oldest);
    }
  }

  private prune(key: string, now: number): number[] {
    const horizon = Math.max(...this.windows.map((w) => w.ms));
    const history = (this.sent.get(key) ?? []).filter((t) => t > now - horizon);
    if (history.length === 0) this.sent.delete(key);
    return history;
  }
}
