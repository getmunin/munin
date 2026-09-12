import { Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { desc, eq, inArray, ne } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { CrmInvalidError } from './crm.errors.ts';
import {
  nextDeliverability,
  normalizeAddress,
  type AddressDeliverabilityDto,
  type AddressDeliverabilityReason,
  type AddressDeliverabilityState,
  type DeliverabilitySeverity,
  type DeliverabilitySnapshot,
} from './address-deliverability.ts';

type Row = typeof schema.crmAddressDeliverability.$inferSelect;

@Injectable()
export class AddressDeliverabilityService {
  async lookup(address: string | null | undefined): Promise<AddressDeliverabilityDto | null> {
    const normalized = normalizeAddress(address);
    if (!normalized) return null;
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmAddressDeliverability)
      .where(eq(schema.crmAddressDeliverability.address, normalized))
      .limit(1);
    return rows[0] ? toDto(rows[0]) : null;
  }

  async lookupMany(
    addresses: ReadonlyArray<string | null | undefined>,
  ): Promise<Map<string, AddressDeliverabilityDto>> {
    const normalized = [...new Set(addresses.map(normalizeAddress).filter(isAddress))];
    if (normalized.length === 0) return new Map();
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmAddressDeliverability)
      .where(inArray(schema.crmAddressDeliverability.address, normalized));
    return new Map(rows.map((row) => [row.address, toDto(row)]));
  }

  async list(input: {
    state?: AddressDeliverabilityState;
    limit?: number;
  }): Promise<AddressDeliverabilityDto[]> {
    const ctx = getCurrentContext();
    const where = input.state
      ? eq(schema.crmAddressDeliverability.state, input.state)
      : ne(schema.crmAddressDeliverability.state, 'valid');
    const rows = await ctx.db
      .select()
      .from(schema.crmAddressDeliverability)
      .where(where)
      .orderBy(desc(schema.crmAddressDeliverability.stateChangedAt))
      .limit(Math.min(input.limit ?? 50, 200));
    return rows.map(toDto);
  }

  async recordFailure(input: {
    address: string | null | undefined;
    severity: DeliverabilitySeverity;
    reason: AddressDeliverabilityReason;
    evidence?: Record<string, unknown>;
  }): Promise<AddressDeliverabilityDto | null> {
    const normalized = normalizeAddress(input.address);
    if (!normalized) return null;
    const now = new Date();
    const current = await this.loadForUpdate(normalized);
    const transition = nextDeliverability(
      current ? toSnapshot(current) : null,
      { severity: input.severity, reason: input.reason },
      now,
    );
    const evidence = {
      ...input.evidence,
      signal: input.reason,
      severity: input.severity,
      observedAt: now.toISOString(),
    };
    return this.write(normalized, {
      state: transition.state,
      reason: transition.reason,
      evidence,
      failureCount: transition.failureCount,
      firstFailureAt: current?.firstFailureAt ?? now,
      lastFailureAt: now,
      stateChangedAt: current?.state === transition.state ? (current?.stateChangedAt ?? now) : now,
    });
  }

  async setState(input: {
    address: string;
    state: 'valid' | 'undeliverable';
    note?: string;
  }): Promise<AddressDeliverabilityDto> {
    return input.state === 'valid'
      ? this.clear({ address: input.address, note: input.note })
      : this.markUndeliverable({ address: input.address, note: input.note });
  }

  async markUndeliverable(input: {
    address: string;
    note?: string;
  }): Promise<AddressDeliverabilityDto> {
    const normalized = normalizeAddress(input.address);
    if (!normalized) throw new CrmInvalidError(`'${input.address}' is not an email address`);
    const now = new Date();
    const current = await this.loadForUpdate(normalized);
    return this.write(normalized, {
      state: 'undeliverable',
      reason: 'manual',
      evidence: { signal: 'manual', note: input.note ?? null, observedAt: now.toISOString() },
      failureCount: (current?.failureCount ?? 0) + 1,
      firstFailureAt: current?.firstFailureAt ?? now,
      lastFailureAt: now,
      stateChangedAt: current?.state === 'undeliverable' ? (current.stateChangedAt ?? now) : now,
    });
  }

  async clear(input: { address: string; note?: string }): Promise<AddressDeliverabilityDto> {
    const normalized = normalizeAddress(input.address);
    if (!normalized) throw new CrmInvalidError(`'${input.address}' is not an email address`);
    const now = new Date();
    return this.write(normalized, {
      state: 'valid',
      reason: 'cleared',
      evidence: { signal: 'cleared', note: input.note ?? null, observedAt: now.toISOString() },
      failureCount: 0,
      firstFailureAt: null,
      lastFailureAt: null,
      stateChangedAt: now,
    });
  }

  private async loadForUpdate(address: string): Promise<Row | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.crmAddressDeliverability)
      .where(eq(schema.crmAddressDeliverability.address, address))
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  private async write(
    address: string,
    values: {
      state: AddressDeliverabilityState;
      reason: AddressDeliverabilityReason;
      evidence: Record<string, unknown>;
      failureCount: number;
      firstFailureAt: Date | null;
      lastFailureAt: Date | null;
      stateChangedAt: Date;
    },
  ): Promise<AddressDeliverabilityDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const now = new Date();
    const rows = await ctx.db
      .insert(schema.crmAddressDeliverability)
      .values({
        orgId: actor.orgId,
        address,
        ...values,
        updatedByActorType: actor.type,
        updatedByActorId: actor.id,
      })
      .onConflictDoUpdate({
        target: [
          schema.crmAddressDeliverability.orgId,
          schema.crmAddressDeliverability.address,
        ],
        set: {
          state: values.state,
          reason: values.reason,
          evidence: values.evidence,
          failureCount: values.failureCount,
          firstFailureAt: values.firstFailureAt,
          lastFailureAt: values.lastFailureAt,
          stateChangedAt: values.stateChangedAt,
          updatedByActorType: actor.type,
          updatedByActorId: actor.id,
          updatedAt: now,
        },
      })
      .returning();
    return toDto(rows[0]!);
  }
}

function isAddress(value: string | null): value is string {
  return value !== null;
}

function toSnapshot(row: Row): DeliverabilitySnapshot {
  return {
    state: row.state as AddressDeliverabilityState,
    reason: (row.reason as AddressDeliverabilityReason | null) ?? null,
    failureCount: row.failureCount,
    lastFailureAt: row.lastFailureAt,
  };
}

function toDto(row: Row): AddressDeliverabilityDto {
  return {
    address: row.address,
    state: row.state as AddressDeliverabilityState,
    reason: (row.reason as AddressDeliverabilityReason | null) ?? null,
    evidence: row.evidence,
    failureCount: row.failureCount,
    firstFailureAt: row.firstFailureAt?.toISOString() ?? null,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    stateChangedAt: row.stateChangedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
