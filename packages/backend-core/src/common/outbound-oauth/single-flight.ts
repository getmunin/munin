export class SingleFlight<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = fn().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
