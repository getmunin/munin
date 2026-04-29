import { Injectable } from '@nestjs/common';
import type { BootstrapRunner } from '@munin/bootstrap';

@Injectable()
export class BootstrapRegistry {
  private readonly byAppKey = new Map<string, BootstrapRunner>();

  add(runner: BootstrapRunner): void {
    if (this.byAppKey.has(runner.appKey)) {
      throw new Error(`Duplicate bootstrap runner for app: ${runner.appKey}`);
    }
    this.byAppKey.set(runner.appKey, runner);
  }

  get(appKey: string): BootstrapRunner | undefined {
    return this.byAppKey.get(appKey);
  }

  appKeys(): string[] {
    return [...this.byAppKey.keys()].sort();
  }
}
