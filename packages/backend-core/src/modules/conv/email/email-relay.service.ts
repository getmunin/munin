import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import { EmailAdapter, parseMessage } from './email-adapter.ts';
import { jsonbToStored, relayInbound } from './email.service.ts';
import { resolveForwardOrigin } from './forwarded-sender.ts';
import type { ChannelRow } from '../channels/adapter.ts';

export type RelayIngestOutcome =
  | { status: 'ingested'; channelId: string; orgId: string; kind: string }
  | { status: 'unknown_recipient' }
  | { status: 'ambiguous_recipient' }
  | { status: 'forwarder_not_allowed' }
  | { status: 'unparseable' };

interface ChannelSqlRow {
  id: string;
  org_id: string;
  type: string;
  vendor: string;
  name: string;
  config: Record<string, unknown>;
  active: boolean;
  default_agent_mode: string;
}

@Injectable()
export class EmailRelayService {
  private readonly logger = new Logger(EmailRelayService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EmailAdapter) private readonly adapter: EmailAdapter,
  ) {}

  async ingestRaw(input: { recipient: string; raw: Buffer }): Promise<RelayIngestOutcome> {
    const recipient = normaliseAddress(input.recipient);
    if (!recipient) return { status: 'unknown_recipient' };

    const channels = await this.findChannelsByRelayAddress(recipient);
    if (channels.length === 0) return { status: 'unknown_recipient' };
    if (channels.length > 1) {
      this.logger.error(
        `relay address ${recipient} resolves to ${channels.length} channels — refusing to guess`,
      );
      return { status: 'ambiguous_recipient' };
    }

    const channel = channels[0]!;
    let parsed;
    try {
      parsed = await parseMessage(input.raw);
    } catch (err) {
      this.logger.warn(
        `relay parse failed channel=${channel.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { status: 'unparseable' };
    }
    if (!parsed.fromAddress) return { status: 'unparseable' };

    const origin = resolveForwardOrigin(parsed, recipient);

    const stored = jsonbToStored(channel.config);
    const allowed = relayInbound(stored)?.allowedForwarders;
    if (allowed?.length && !forwarderAllowed(origin.forwardedBy, parsed.fromAddress, allowed)) {
      this.logger.warn(
        `relay rejected channel=${channel.id} forwardedBy=${origin.forwardedBy ?? 'none'} not in allowlist`,
      );
      return { status: 'forwarder_not_allowed' };
    }

    await this.adapter.ingest(channel, parsed, origin);
    return {
      status: 'ingested',
      channelId: channel.id,
      orgId: channel.orgId,
      kind: origin.kind,
    };
  }

  private async findChannelsByRelayAddress(address: string): Promise<ChannelRow[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx.execute<ChannelSqlRow & Record<string, unknown>>(sql`
        SELECT id, org_id, type, vendor, name, config, active, default_agent_mode
        FROM conv_channels
        WHERE type = 'email'
          AND active = true
          AND archived_at IS NULL
          AND config -> 'inbound' ->> 'provider' = 'relay'
          AND lower(config -> 'inbound' ->> 'address') = ${address}
        LIMIT 2
      `);
      return rows.map((row) => ({
        id: row.id,
        orgId: row.org_id,
        type: row.type,
        vendor: row.vendor,
        name: row.name,
        config: row.config,
        active: row.active,
        defaultAgentMode: row.default_agent_mode,
      }));
    });
  }
}

export function normaliseAddress(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const angled = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  const address = angled ? angled[1]! : trimmed;
  if (!address.includes('@') || /\s/.test(address)) return null;
  return address;
}

export function forwarderAllowed(
  forwardedBy: string | null,
  envelopeFrom: string,
  allowed: string[],
): boolean {
  const candidates = [forwardedBy, envelopeFrom]
    .filter((v): v is string => !!v)
    .map((v) => v.split('@')[1]?.toLowerCase())
    .filter((v): v is string => !!v);
  return candidates.some((domain) =>
    allowed.some((entry) => domain === entry || domain.endsWith(`.${entry}`)),
  );
}
