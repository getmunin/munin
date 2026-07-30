import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { schema } from '@getmunin/db';
import type { AgentMode } from '@getmunin/types';
import {
  CHANNEL_ADMIN_PROVIDERS,
  PENDING_SETUP_KEY,
  readPendingSetup,
  type ChannelAdminDto,
  type ChannelAdminProvider,
  type ChannelOptionsDto,
} from './channel-admin.ts';

@Injectable()
export class ChannelAdminService {
  private readonly logger = new Logger(ChannelAdminService.name);
  private readonly byVendor = new Map<string, ChannelAdminProvider>();

  constructor(@Inject(CHANNEL_ADMIN_PROVIDERS) providers: ChannelAdminProvider[]) {
    for (const provider of providers) {
      if (this.byVendor.has(provider.vendor)) {
        throw new Error(`duplicate ChannelAdminProvider for vendor '${provider.vendor}'`);
      }
      this.byVendor.set(provider.vendor, provider);
    }
  }

  listVendors() {
    return [...this.byVendor.values()].map((p) => ({
      vendor: p.vendor,
      kind: p.kind,
      displayName: p.displayName,
      capabilities: p.capabilities,
      configFields: p.configFields,
    }));
  }

  async configure(
    input: {
      vendor: string;
      channelId?: string;
      name?: string;
      config: Record<string, unknown>;
      defaultAgentMode?: AgentMode;
    },
    opts?: { rejectSecrets?: boolean },
  ): Promise<ChannelAdminDto> {
    const provider = this.requireVendor(input.vendor);
    if (opts?.rejectSecrets) this.assertNoSecrets(provider, input.config);
    if (input.defaultAgentMode && provider.kind !== 'sms') {
      throw new BadRequestException(
        `defaultAgentMode does not apply to ${provider.kind} channels — an inbound call is run by the vendor's assistant, not by the Munin agent`,
      );
    }
    if (input.channelId) await this.assertNotPending(input.channelId);
    if (opts?.rejectSecrets && !input.channelId) {
      const pending = await this.createPending(provider, {
        name: input.name,
        config: input.config,
      });
      return this.applyDefaultAgentMode(pending, input.defaultAgentMode);
    }
    const parsed = provider.configInput.safeParse(input.config);
    if (!parsed.success) {
      throw new BadRequestException(`invalid config for ${input.vendor}: ${parsed.error.message}`);
    }
    const configured = await provider.configure({
      channelId: input.channelId,
      name: input.name,
      config: parsed.data,
    });
    return this.applyDefaultAgentMode(configured, input.defaultAgentMode);
  }

  private async applyDefaultAgentMode(
    channel: ChannelAdminDto,
    defaultAgentMode: AgentMode | undefined,
  ): Promise<ChannelAdminDto> {
    if (!defaultAgentMode) return channel;
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.convChannels)
      .set({ defaultAgentMode, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channel.id));
    return { ...channel, defaultAgentMode };
  }

  async completeSetup(
    channelId: string,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const provider = await this.providerForChannel(channelId, { allowPending: true });
    if (!provider.completeSetup) {
      return { ok: false, error: `channel vendor '${provider.vendor}' does not support credential links` };
    }
    return provider.completeSetup(channelId, secrets);
  }

  providerFor(vendor: string): ChannelAdminProvider | undefined {
    return this.byVendor.get(vendor);
  }

  private assertNoSecrets(provider: ChannelAdminProvider, config: Record<string, unknown>): void {
    const provided = provider.configFields
      .filter((f) => f.secret)
      .map((f) => f.name)
      .filter((name) => config[name] !== undefined);
    if (provided.length > 0) {
      throw new BadRequestException(
        `conv_invalid: secret fields (${provided.join(', ')}) cannot be accepted through this tool — omit them, and a one-time credential link is returned for a human to enter them in the dashboard`,
      );
    }
  }

  private async assertNotPending(channelId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    if (rows[0] && readPendingSetup(rows[0].config)) {
      throw new BadRequestException(
        'conv_invalid: channel is awaiting credentials — complete the credential link first',
      );
    }
  }

  private async createPending(
    provider: ChannelAdminProvider,
    input: { name?: string; config: Record<string, unknown> },
  ): Promise<ChannelAdminDto> {
    if (!input.name) throw new BadRequestException('name is required when creating a channel');
    if (!provider.validatePendingConfig || !provider.completeSetup) {
      throw new BadRequestException(
        `channel vendor '${provider.vendor}' does not support credential links`,
      );
    }
    const pending = provider.validatePendingConfig(input.config);
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: ctx.actor!.orgId,
        type: provider.kind,
        vendor: provider.vendor,
        name: input.name,
        config: { [PENDING_SETUP_KEY]: pending },
        active: false,
      })
      .returning();
    return {
      id: row!.id,
      name: row!.name,
      type: row!.type,
      vendor: row!.vendor,
      active: row!.active,
      config: pending,
    };
  }

  async test(channelId: string): Promise<unknown> {
    return this.providerForChannel(channelId).then((p) => p.test(channelId));
  }

  async listOptions(input: {
    vendor?: string;
    channelId?: string;
    config?: Record<string, unknown>;
  }): Promise<ChannelOptionsDto> {
    const provider = input.channelId
      ? await this.providerForChannel(input.channelId)
      : this.requireVendor(input.vendor ?? '');
    if (!provider.listOptions) {
      throw new BadRequestException(
        `channel vendor '${provider.vendor}' does not support option discovery`,
      );
    }
    return provider.listOptions({ channelId: input.channelId, config: input.config });
  }

  async call(input: { channelId: string; to: string; customerName?: string }): Promise<unknown> {
    const provider = await this.providerForChannel(input.channelId);
    if (!provider.call) {
      throw new BadRequestException(`channel vendor '${provider.vendor}' does not support voice calls`);
    }
    return provider.call(input);
  }

  async sendTest(input: { channelId: string; to: string; body?: string }): Promise<unknown> {
    const provider = await this.providerForChannel(input.channelId);
    if (!provider.sendTest) {
      throw new BadRequestException(`channel vendor '${provider.vendor}' does not support test sends`);
    }
    return provider.sendTest(input);
  }

  async onArchive(channelId: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({ vendor: schema.convChannels.vendor })
      .from(schema.convChannels)
      .where(
        and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)),
      )
      .limit(1);
    const provider = rows[0] ? this.byVendor.get(rows[0].vendor) : undefined;
    if (!provider?.onArchive) return;
    await provider.onArchive(channelId).catch((err: unknown) => {
      this.logger.warn(
        `onArchive hook failed for channel ${channelId} (${provider.vendor}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  private requireVendor(vendor: string): ChannelAdminProvider {
    const provider = this.byVendor.get(vendor);
    if (!provider) {
      throw new BadRequestException(
        `unknown channel vendor '${vendor}'. Call conv_list_channel_vendors to see the available vendors.`,
      );
    }
    return provider;
  }

  private async providerForChannel(
    channelId: string,
    opts?: { allowPending?: boolean },
  ): Promise<ChannelAdminProvider> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({ vendor: schema.convChannels.vendor, config: schema.convChannels.config })
      .from(schema.convChannels)
      .where(
        and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`channel ${channelId} not found`);
    if (!opts?.allowPending && readPendingSetup(row.config)) {
      throw new BadRequestException(
        'conv_invalid: channel is awaiting credentials — complete the credential link first',
      );
    }
    return this.requireVendor(row.vendor);
  }
}
