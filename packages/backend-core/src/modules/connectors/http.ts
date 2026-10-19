import { findResponseTooLarge } from '@getmunin/core';

export const REQUEST_TIMEOUT_MS = 10_000;

export class ConnectorVendorError extends Error {
  notFound?: boolean;
  quotaExceeded?: boolean;
}

export function asVendorError(err: unknown): unknown {
  const tooLarge = findResponseTooLarge(err);
  if (!tooLarge) return err;
  return new ConnectorVendorError(
    `the vendor sent a response larger than the ${tooLarge.limitBytes}-byte limit (response_too_large)`,
  );
}

export type ConnectorFetch = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
