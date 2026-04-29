import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.module.js';
import { CHANNEL_ADAPTERS, ChannelAdapterRegistry, type ChannelAdapter } from './adapter.js';

const POLL_INTERVAL_MS = Number(
  process.env.MUNIN_INBOUND_POLL_WORKER_INTERVAL_MS ??
    process.env.MUNIN_EMAIL_INBOUND_POLL_MS ??
    60_000,
);

/**
 * Generic poll-mode inbound worker. Iterates active channels whose adapter
 * is poll-mode and dispatches `adapter.inbound.tick(channel)`. Per-tick
 * cursor / error bookkeeping lives in `conv_inbound_state`, which adapters
 * read/write themselves (the worker is purely a scheduler).
 *
 * Disabled in tests via `MUNIN_INBOUND_POLL_WORKER_DISABLED=1` (or legacy
 * `MUNIN_EMAIL_INBOUND_WORKER_DISABLED=1`) or `NODE_ENV=test`. Tests call
 * `tick()` directly.
 */
@Injectable()
export class InboundPollWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    process.env.MUNIN_INBOUND_POLL_WORKER_DISABLED === '1' ||
    process.env.MUNIN_EMAIL_INBOUND_WORKER_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';

  private readonly registry: ChannelAdapterRegistry;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CHANNEL_ADAPTERS) adapters: ChannelAdapter[],
  ) {
    this.registry = new ChannelAdapterRegistry(adapters);
  }

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Public so tests can drive a single tick directly. */
  async tick(): Promise<{ channelsPolled: number; messagesIngested: number }> {
    if (this.running) return { channelsPolled: 0, messagesIngested: 0 };
    this.running = true;
    try {
      return await this.runOnce();
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<{ channelsPolled: number; messagesIngested: number }> {
    const pollAdapters = this.registry.pollAdapters();
    if (pollAdapters.length === 0) return { channelsPolled: 0, messagesIngested: 0 };

    const kinds = pollAdapters.map((a) => a.kind);
    const channels = await this.db
      .select()
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.active, true)));

    let polled = 0;
    let ingested = 0;
    for (const channel of channels) {
      if (!kinds.includes(channel.type as ChannelAdapter['kind'])) continue;
      const adapter = this.registry.get(channel.type)!;
      if (adapter.inbound?.mode !== 'poll') continue;
      try {
        const result = await adapter.inbound.tick(channel);
        ingested += result.messagesIngested;
        polled += 1;
      } catch {
        // Adapter errors should already be persisted on convInboundState by
        // the adapter itself; the worker keeps going.
      }
    }
    return { channelsPolled: polled, messagesIngested: ingested };
  }
}
