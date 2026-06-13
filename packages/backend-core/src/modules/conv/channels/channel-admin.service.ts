import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { schema } from '@getmunin/db';
import {
  CHANNEL_ADMIN_PROVIDERS,
  type ChannelAdminDto,
  type ChannelAdminProvider,
} from './channel-admin.ts';

@Injectable()
export class ChannelAdminService {
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

  async configure(input: {
    vendor: string;
    channelId?: string;
    name?: string;
    config: Record<string, unknown>;
  }): Promise<ChannelAdminDto> {
    const provider = this.requireVendor(input.vendor);
    const parsed = provider.configInput.safeParse(input.config);
    if (!parsed.success) {
      throw new BadRequestException(`invalid config for ${input.vendor}: ${parsed.error.message}`);
    }
    return provider.configure({
      channelId: input.channelId,
      name: input.name,
      config: parsed.data,
    });
  }

  async test(channelId: string): Promise<unknown> {
    return this.providerForChannel(channelId).then((p) => p.test(channelId));
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

  private requireVendor(vendor: string): ChannelAdminProvider {
    const provider = this.byVendor.get(vendor);
    if (!provider) {
      throw new BadRequestException(
        `unknown channel vendor '${vendor}'. Call conv_list_channel_vendors to see the available vendors.`,
      );
    }
    return provider;
  }

  private async providerForChannel(channelId: string): Promise<ChannelAdminProvider> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({ vendor: schema.convChannels.vendor })
      .from(schema.convChannels)
      .where(
        and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`channel ${channelId} not found`);
    return this.requireVendor(row.vendor);
  }
}
