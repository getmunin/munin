const LOCAL_FALLBACK = 'http://localhost:3001';

export function readApiBaseUrl(): string {
  const raw = process.env.MUNIN_API_URL ?? mcpOrigin() ?? LOCAL_FALLBACK;
  return raw.replace(/\/+$/, '');
}

function mcpOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_MCP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
