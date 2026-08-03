import { isSensitiveSchema } from '@getmunin/types';
import type { z } from 'zod';

export type ChannelAdminKind = 'voice' | 'sms' | 'chat';

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
  defaultAgentMode?: string;
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

export interface CompleteSetupResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface ChannelAdminProvider {
  readonly kind: ChannelAdminKind;
  readonly vendor: string;
  readonly displayName: string;
  readonly configInput: z.ZodType;
  readonly configFields: ChannelConfigFieldInfo[];
  readonly capabilities: { call: boolean; sendTest: boolean };
  configure(input: ConfigureChannelInput): Promise<ChannelAdminDto>;
  test(channelId: string): Promise<unknown>;
  call?(input: { channelId: string; to: string; customerName?: string }): Promise<unknown>;
  sendTest?(input: { channelId: string; to: string; body?: string }): Promise<unknown>;
  listOptions?(input: ListChannelOptionsInput): Promise<ChannelOptionsDto>;
  onArchive?(channelId: string): Promise<void>;
  validatePendingConfig?(config: Record<string, unknown>): Record<string, unknown>;
  completeSetup?(channelId: string, secrets: Record<string, string>): Promise<CompleteSetupResult>;
}

export const PENDING_SETUP_KEY = 'pendingSetup';

export function readPendingSetup(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== 'object') return null;
  const pending = (config as Record<string, unknown>)[PENDING_SETUP_KEY];
  if (!pending || typeof pending !== 'object') return null;
  return pending as Record<string, unknown>;
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
