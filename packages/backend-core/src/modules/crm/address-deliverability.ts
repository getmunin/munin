export const ADDRESS_DELIVERABILITY_STATES = ['valid', 'soft_failing', 'undeliverable'] as const;
export type AddressDeliverabilityState = (typeof ADDRESS_DELIVERABILITY_STATES)[number];

export const ADDRESS_DELIVERABILITY_REASONS = [
  'hard_bounce',
  'smtp_rejected',
  'delivery_dead',
  'no_reply_notice',
  'repeated_soft_failure',
  'manual',
  'cleared',
] as const;
export type AddressDeliverabilityReason = (typeof ADDRESS_DELIVERABILITY_REASONS)[number];

export type DeliverabilitySeverity = 'hard' | 'soft';

export const SOFT_FAILURE_WINDOW_DAYS = 30;
export const SOFT_FAILURES_BEFORE_UNDELIVERABLE = 3;

const SOFT_FAILURE_WINDOW_MS = SOFT_FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface AddressDeliverabilityDto {
  address: string;
  state: AddressDeliverabilityState;
  reason: AddressDeliverabilityReason | null;
  evidence: Record<string, unknown>;
  failureCount: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  stateChangedAt: string;
  updatedAt: string;
}

export interface DeliverabilitySnapshot {
  state: AddressDeliverabilityState;
  reason: AddressDeliverabilityReason | null;
  failureCount: number;
  lastFailureAt: Date | null;
}

export interface DeliverabilitySignal {
  severity: DeliverabilitySeverity;
  reason: AddressDeliverabilityReason;
}

export interface DeliverabilityTransition {
  state: AddressDeliverabilityState;
  reason: AddressDeliverabilityReason;
  failureCount: number;
}

export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const inner = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  const trimmed = inner.trim().replace(/^mailto:/i, '').toLowerCase();
  if (!trimmed || trimmed.length > 320) return null;
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function nextDeliverability(
  current: DeliverabilitySnapshot | null,
  signal: DeliverabilitySignal,
  now: Date,
): DeliverabilityTransition {
  const withinWindow =
    current?.lastFailureAt != null &&
    now.getTime() - current.lastFailureAt.getTime() <= SOFT_FAILURE_WINDOW_MS;
  const failureCount = (withinWindow ? (current?.failureCount ?? 0) : 0) + 1;

  if (signal.severity === 'hard') {
    return { state: 'undeliverable', reason: signal.reason, failureCount };
  }
  if (current?.state === 'undeliverable') {
    return { state: 'undeliverable', reason: current.reason ?? signal.reason, failureCount };
  }
  if (failureCount >= SOFT_FAILURES_BEFORE_UNDELIVERABLE) {
    return { state: 'undeliverable', reason: 'repeated_soft_failure', failureCount };
  }
  return { state: 'soft_failing', reason: signal.reason, failureCount };
}

export type DeliverabilityVerdict = DeliverabilitySeverity | 'inconclusive';

const PERMANENT_MAILBOX_STATUS = /\b5\.1\.(?:1|2|3|4|5|6|10)\b/;
const PERMANENT_MAILBOX_PROSE =
  /\b(?:user unknown|no such user|unknown user|recipient (?:address )?rejected|mailbox (?:unavailable|not found|does not exist)|address (?:rejected|unknown)|does not exist|recipient not found)\b/i;
const PERMANENT_REPLY_CODE = /\b55[0-3]\b/;
const MAILBOX_CAPACITY = /\b(?:4\.2\.\d+|5\.2\.2)\b|\b(?:mailbox full|over quota|quota exceeded|insufficient storage)\b/i;

export function classifySmtpFailure(error: string | null | undefined): DeliverabilityVerdict {
  if (!error) return 'inconclusive';
  if (PERMANENT_MAILBOX_STATUS.test(error)) return 'hard';
  if (PERMANENT_REPLY_CODE.test(error) && PERMANENT_MAILBOX_PROSE.test(error)) return 'hard';
  if (MAILBOX_CAPACITY.test(error)) return 'soft';
  return 'inconclusive';
}
