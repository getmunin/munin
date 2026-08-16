export interface DrainScheduler {
  enqueue(run: () => void): () => void;
}

export function createDrainScheduler(
  spacingMs: number,
  now: () => number = Date.now,
): DrainScheduler {
  let nextAt = 0;
  return {
    enqueue(run) {
      const current = now();
      const at = Math.max(current, nextAt);
      nextAt = at + spacingMs;
      const timer = setTimeout(run, at - current);
      return () => clearTimeout(timer);
    },
  };
}
