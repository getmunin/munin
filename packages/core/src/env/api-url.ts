const LOCAL_FALLBACK = 'http://localhost:3001';

export function readApiBaseUrl(): string {
  const raw = process.env.MUNIN_API_URL ?? LOCAL_FALLBACK;
  return raw.replace(/\/+$/, '');
}
