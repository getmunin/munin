export const REQUEST_TIMEOUT_MS = 10_000;

export class ConnectorVendorError extends Error {
  notFound?: boolean;
  quotaExceeded?: boolean;
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
