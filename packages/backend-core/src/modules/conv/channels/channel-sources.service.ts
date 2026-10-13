import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';

export const BINDABLE_CONNECTOR_DOMAINS = ['commerce', 'bookings'] as const;

export interface ChannelSourcesDto {
  channelId: string;
  kbSpaces: Array<{ id: string; slug: string; name: string }>;
  connections: Array<{ id: string; name: string; vendor: string; domain: string }>;
}

export interface SetChannelSourcesInput {
  channelId: string;
  kbSpaceIds?: string[];
  connectionIds?: string[];
}

@Injectable()
export class ChannelSourcesService {
  async list(): Promise<ChannelSourcesDto[]> {
    const ctx = getCurrentContext();
    const spaceRows = await ctx.db
      .select({
        channelId: schema.convChannelKbSpaces.channelId,
        id: schema.kbSpaces.id,
        slug: schema.kbSpaces.slug,
        name: schema.kbSpaces.name,
      })
      .from(schema.convChannelKbSpaces)
      .innerJoin(schema.kbSpaces, eq(schema.kbSpaces.id, schema.convChannelKbSpaces.spaceId))
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convChannelKbSpaces.channelId))
      .where(isNull(schema.convChannels.archivedAt))
      .orderBy(schema.kbSpaces.slug);
    const connectionRows = await ctx.db
      .select({
        channelId: schema.convChannelConnections.channelId,
        id: schema.connectorConnections.id,
        name: schema.connectorConnections.name,
        vendor: schema.connectorConnections.vendor,
        domain: schema.connectorConnections.domain,
      })
      .from(schema.convChannelConnections)
      .innerJoin(
        schema.connectorConnections,
        eq(schema.connectorConnections.id, schema.convChannelConnections.connectionId),
      )
      .innerJoin(schema.convChannels, eq(schema.convChannels.id, schema.convChannelConnections.channelId))
      .where(isNull(schema.convChannels.archivedAt))
      .orderBy(schema.connectorConnections.domain);
    const byChannel = new Map<string, ChannelSourcesDto>();
    const entry = (channelId: string): ChannelSourcesDto => {
      let dto = byChannel.get(channelId);
      if (!dto) {
        dto = { channelId, kbSpaces: [], connections: [] };
        byChannel.set(channelId, dto);
      }
      return dto;
    };
    for (const { channelId, ...space } of spaceRows) entry(channelId).kbSpaces.push(space);
    for (const { channelId, ...connection } of connectionRows) {
      entry(channelId).connections.push(connection);
    }
    return [...byChannel.values()];
  }

  async get(channelId: string): Promise<ChannelSourcesDto> {
    await this.requireChannel(channelId);
    return this.read(channelId);
  }

  async set(input: SetChannelSourcesInput): Promise<ChannelSourcesDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    await this.requireChannel(input.channelId);

    const kbSpaceIds = input.kbSpaceIds ? [...new Set(input.kbSpaceIds)] : undefined;
    const connectionIds = input.connectionIds ? [...new Set(input.connectionIds)] : undefined;
    if (kbSpaceIds) await this.assertSpacesExist(kbSpaceIds);
    const connections = connectionIds ? await this.loadBindableConnections(connectionIds) : undefined;

    if (kbSpaceIds) {
      await ctx.db
        .delete(schema.convChannelKbSpaces)
        .where(eq(schema.convChannelKbSpaces.channelId, input.channelId));
      if (kbSpaceIds.length > 0) {
        await ctx.db.insert(schema.convChannelKbSpaces).values(
          kbSpaceIds.map((spaceId) => ({ orgId, channelId: input.channelId, spaceId })),
        );
      }
    }
    if (connections) {
      await ctx.db
        .delete(schema.convChannelConnections)
        .where(eq(schema.convChannelConnections.channelId, input.channelId));
      if (connections.length > 0) {
        await ctx.db.insert(schema.convChannelConnections).values(
          connections.map((c) => ({
            orgId,
            channelId: input.channelId,
            connectionId: c.id,
            domain: c.domain,
          })),
        );
      }
    }
    return this.read(input.channelId);
  }

  private async requireChannel(channelId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.convChannels.id })
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.id, channelId), isNull(schema.convChannels.archivedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`conv_not_found: channel ${channelId}`);
  }

  private async assertSpacesExist(spaceIds: string[]): Promise<void> {
    if (spaceIds.length === 0) return;
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.kbSpaces.id })
      .from(schema.kbSpaces)
      .where(inArray(schema.kbSpaces.id, spaceIds));
    const found = new Set(rows.map((r) => r.id));
    const missing = spaceIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`conv_invalid: unknown KB space(s): ${missing.join(', ')}`);
    }
  }

  private async loadBindableConnections(
    connectionIds: string[],
  ): Promise<Array<{ id: string; domain: string }>> {
    if (connectionIds.length === 0) return [];
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        id: schema.connectorConnections.id,
        name: schema.connectorConnections.name,
        domain: schema.connectorConnections.domain,
      })
      .from(schema.connectorConnections)
      .where(inArray(schema.connectorConnections.id, connectionIds));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = connectionIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`conv_invalid: unknown connection(s): ${missing.join(', ')}`);
    }
    const bindable: readonly string[] = BINDABLE_CONNECTOR_DOMAINS;
    const seen = new Map<string, string>();
    for (const id of connectionIds) {
      const row = byId.get(id)!;
      if (!bindable.includes(row.domain)) {
        throw new BadRequestException(
          `conv_invalid: connection ${row.name} is a ${row.domain} connection; only ${BINDABLE_CONNECTOR_DOMAINS.join(' and ')} connections can be bound to a channel`,
        );
      }
      const other = seen.get(row.domain);
      if (other) {
        throw new BadRequestException(
          `conv_invalid: a channel takes one ${row.domain} connection, got ${other} and ${row.name}`,
        );
      }
      seen.set(row.domain, row.name);
    }
    return connectionIds.map((id) => ({ id, domain: byId.get(id)!.domain }));
  }

  private async read(channelId: string): Promise<ChannelSourcesDto> {
    const ctx = getCurrentContext();
    const kbSpaces = await ctx.db
      .select({ id: schema.kbSpaces.id, slug: schema.kbSpaces.slug, name: schema.kbSpaces.name })
      .from(schema.convChannelKbSpaces)
      .innerJoin(schema.kbSpaces, eq(schema.kbSpaces.id, schema.convChannelKbSpaces.spaceId))
      .where(eq(schema.convChannelKbSpaces.channelId, channelId))
      .orderBy(schema.kbSpaces.slug);
    const connections = await ctx.db
      .select({
        id: schema.connectorConnections.id,
        name: schema.connectorConnections.name,
        vendor: schema.connectorConnections.vendor,
        domain: schema.connectorConnections.domain,
      })
      .from(schema.convChannelConnections)
      .innerJoin(
        schema.connectorConnections,
        eq(schema.connectorConnections.id, schema.convChannelConnections.connectionId),
      )
      .where(eq(schema.convChannelConnections.channelId, channelId))
      .orderBy(schema.connectorConnections.domain);
    return { channelId, kbSpaces, connections };
  }
}
