import { sql } from 'drizzle-orm';
import type { Db, Tx } from '@getmunin/db';
import type {
  RootTransactionRunner,
  SocialEventEmitter,
  SocialPublisherLookup,
  SocialTokenSource,
} from './social.service.ts';
import type { SocialPublishRequest, SocialPublishResult } from './social-oauth.ts';
import type { SocialPlatform } from './social-platform.ts';

export class StubTokenSource implements SocialTokenSource {
  calls: { userId: string; orgId: string; platform: SocialPlatform }[] = [];
  constructor(private readonly outcome: { token: string } | { error: Error } = { token: 'at' }) {}

  accessTokenFor(args: {
    userId: string;
    orgId: string;
    platform: SocialPlatform;
  }): Promise<string> {
    this.calls.push(args);
    if ('error' in this.outcome) return Promise.reject(this.outcome.error);
    return Promise.resolve(this.outcome.token);
  }
}

export class StubPublisherLookup implements SocialPublisherLookup {
  requests: SocialPublishRequest[] = [];

  constructor(
    private readonly outcome:
      | { result: SocialPublishResult }
      | { error: Error }
      | { unsupported: true } = {
      result: { externalPostId: 'urn:li:share:1', permalink: null },
    },
  ) {}

  get(_platform: SocialPlatform) {
    const outcome = this.outcome;
    if ('unsupported' in outcome) return {};
    return {
      publish: (args: SocialPublishRequest): Promise<SocialPublishResult> => {
        this.requests.push(args);
        if ('error' in outcome) return Promise.reject(outcome.error);
        return Promise.resolve(outcome.result);
      },
    };
  }
}

export class PassthroughTransactionRunner implements RootTransactionRunner {
  constructor(private readonly tx: () => Tx) {}

  inRootTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn(this.tx());
  }
}

export class UnusedTransactionRunner implements RootTransactionRunner {
  inRootTransaction<T>(): Promise<T> {
    throw new Error('no root transaction was expected in this test');
  }
}

export class DbRootTransactionRunner implements RootTransactionRunner {
  constructor(private readonly db: Db) {}

  inRootTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      return fn(tx);
    });
  }
}

export class StubEventEmitter implements SocialEventEmitter {
  emitted: { type: string; payload: Record<string, unknown> }[] = [];
  private counter = 0;

  emit(input: { type: string; payload: Record<string, unknown> }): Promise<string> {
    this.emitted.push(input);
    this.counter += 1;
    return Promise.resolve(`evt_stub_${this.counter}`);
  }

  typesFor(draftId: string): string[] {
    return this.emitted.filter((e) => e.payload.draftId === draftId).map((e) => e.type);
  }
}
