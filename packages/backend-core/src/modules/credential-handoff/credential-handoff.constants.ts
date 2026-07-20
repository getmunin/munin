export function readWebBaseUrl(): string {
  return (process.env.MUNIN_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export function credentialLinkUrl(token: string): string {
  return `${readWebBaseUrl()}/connect/credentials?token=${encodeURIComponent(token)}`;
}
