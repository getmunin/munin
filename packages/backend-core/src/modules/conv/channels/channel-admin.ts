import { isSensitiveSchema } from '@getmunin/types';
import type { z } from 'zod';

/**
 * Vendor-agnostic admin surface for configurable channels.
 *
 * Each configurable vendor registers a `ChannelAdminProvider` (under the
 * `CHANNEL_ADMIN_PROVIDERS` multi-token); the generic `conv_channel_*` MCP
 * tools and `/v1/conversations/channels` endpoints dispatch to it by vendor.
 * Adding a voice/SMS vendor means registering one provider — no new tools,
 * endpoints, or types.
 */
export type ChannelAdminKind = 'voice' | 'sms';

export interface ChannelConfigFieldInfo {
  name: string;
  required: boolean;
  secret: boolean;
  description?: string;
}

export interface ChannelAdminDto {
  id: string;
  name: string;
  type: string;
  vendor: string;
  active: boolean;
  config: unknown;
}

export interface ConfigureChannelInput {
  channelId?: string;
  name?: string;
  config: unknown;
}

export interface ChannelOption {
  value: string;
  label: string;
  hint?: string;
}

export interface ChannelOptionGroup {
  key: string;
  label: string;
  options: ChannelOption[];
}

export interface ChannelOptionsDto {
  groups: ChannelOptionGroup[];
  context?: { label?: string };
}

export interface ListChannelOptionsInput {
  channelId?: string;
  config?: unknown;
}

export interface ChannelAdminProvider {
  readonly kind: ChannelAdminKind;
  readonly vendor: string;
  readonly displayName: string;
  /** Validates the `config` blob (no channelId/name). */
  readonly configInput: z.ZodType;
  /** Field metadata derived from `configInput`, for discovery. */
  readonly configFields: ChannelConfigFieldInfo[];
  readonly capabilities: { call: boolean; sendTest: boolean };
  configure(input: ConfigureChannelInput): Promise<ChannelAdminDto>;
  test(channelId: string): Promise<unknown>;
  call?(input: { channelId: string; to: string; customerName?: string }): Promise<unknown>;
  sendTest?(input: { channelId: string; to: string; body?: string }): Promise<unknown>;
  listOptions?(input: ListChannelOptionsInput): Promise<ChannelOptionsDto>;
  onArchive?(channelId: string): Promise<void>;
}

export const CHANNEL_ADMIN_PROVIDERS = Symbol('CHANNEL_ADMIN_PROVIDERS');

export function describeConfigFields(schema: z.ZodType): ChannelConfigFieldInfo[] {
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape as Record<string, z.ZodType>;
  return Object.entries(shape).map(([name, field]) => ({
    name,
    required: !field.isOptional(),
    secret: isSensitiveSchema(field),
    description: field.description,
  }));
}
