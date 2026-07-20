export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Vendor-side failure (bad credentials, HTTP error, malformed response).
 * The service layer maps this to a 4xx instead of letting it surface as a
 * bare 500 from inside the tenant transaction.
 */
export class ConnectorVendorError extends Error {
  notFound?: boolean;
}

/**
 * Minimal fetch shape shared by @getmunin/core's safeFetch and test stubs.
 * Adapters must go through this (never global fetch) so every outbound call
 * gets SSRF-guarded DNS resolution — Magento base URLs are user-supplied.
 */
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
