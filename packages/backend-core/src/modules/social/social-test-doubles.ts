import { sql } from 'drizzle-orm';
import type { Db, Tx } from '@getmunin/db';
import type {
  RootTransactionRunner,
  SocialEventEmitter,
  SocialPublisherLookup,
  SocialTokenSource,
} from './social.service.ts';
import type {
  SocialMediaRef,
  SocialMediaUpload,
  SocialPublishRequest,
  SocialPublishResult,
} from './social-oauth.ts';
import type { SocialPlatform } from './social-platform.ts';
import type {
  FetchedMedia,
  OpenGraphSummary,
  SocialMediaReader,
} from './social-media.ts';

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

class StubPublisher {
  constructor(
    private readonly lookup: StubPublisherLookup,
    private readonly outcome: { result: SocialPublishResult } | { error: Error },
    private readonly uploadOutcome: { ref: SocialMediaRef } | { error: Error },
  ) {}

  publish(args: SocialPublishRequest): Promise<SocialPublishResult> {
    this.lookup.requests.push(args);
    const outcome = this.outcome;
    if ('error' in outcome) return Promise.reject(outcome.error);
    return Promise.resolve(outcome.result);
  }

  uploadMedia(args: {
    accessToken: string;
    externalAccountId: string;
    media: SocialMediaUpload;
  }): Promise<SocialMediaRef> {
    this.lookup.uploads.push(args.media);
    const upload = this.uploadOutcome;
    if ('error' in upload) return Promise.reject(upload.error);
    return Promise.resolve({ ...upload.ref, kind: args.media.kind, altText: args.media.altText });
  }
}

export class StubPublisherLookup implements SocialPublisherLookup {
  requests: SocialPublishRequest[] = [];
  uploads: SocialMediaUpload[] = [];

  constructor(
    private readonly outcome:
      | { result: SocialPublishResult }
      | { error: Error }
      | { unsupported: true } = {
      result: {
        externalPostId: 'urn:li:share:1',
        permalink: null,
        commentExternalId: null,
        commentError: null,
      },
    },
    private readonly uploadOutcome: { ref: SocialMediaRef } | { error: Error } = {
      ref: { kind: 'image', id: 'urn:li:image:1', altText: null },
    },
  ) {}

  get(_platform: SocialPlatform) {
    const outcome = this.outcome;
    if ('unsupported' in outcome) return {};
    return new StubPublisher(this, outcome, this.uploadOutcome);
  }
}

export class StubMediaReader implements SocialMediaReader {
  pages: string[] = [];
  media: string[] = [];

  constructor(
    private readonly outcome: {
      preview?: OpenGraphSummary | Error;
      media?: FetchedMedia | Error;
    } = {},
  ) {}

  fetchOpenGraph(pageUrl: string): Promise<OpenGraphSummary> {
    this.pages.push(pageUrl);
    const preview = this.outcome.preview ?? { title: null, description: null, imageUrl: null };
    if (preview instanceof Error) return Promise.reject(preview);
    return Promise.resolve(preview);
  }

  fetchMedia(mediaUrl: string): Promise<FetchedMedia> {
    this.media.push(mediaUrl);
    const media = this.outcome.media;
    if (media instanceof Error) return Promise.reject(media);
    if (!media) {
      return Promise.resolve({
        kind: 'image',
        contentType: 'image/png',
        bytes: Buffer.from('png-bytes'),
        sourceUrl: mediaUrl,
      });
    }
    return Promise.resolve(media);
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
