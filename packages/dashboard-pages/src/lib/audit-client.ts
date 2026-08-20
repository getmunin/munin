export type ClientKind =
  | 'sdk'
  | 'cli'
  | 'mcp'
  | 'dashboard'
  | 'browser'
  | 'widget'
  | 'unknown';

export function clientLabel(client: ClientKind, origin: string | null): string {
  if (client !== 'browser' || !origin) return client;
  return originHost(origin) ?? client;
}

export function clientTitle(origin: string | null, userAgent: string | null): string | undefined {
  const parts = [origin, userAgent].filter((v): v is string => !!v);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
