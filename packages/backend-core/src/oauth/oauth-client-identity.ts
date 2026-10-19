interface KnownClient {
  name: string;
  hosts: readonly string[];
  sharedHosts?: readonly string[];
  keywords: readonly string[];
  exactNames?: readonly string[];
}

const KNOWN_CLIENTS: readonly KnownClient[] = [
  { name: 'Claude', hosts: ['claude.ai', 'anthropic.com'], keywords: ['claude', 'anthropic'] },
  { name: 'ChatGPT', hosts: ['chatgpt.com', 'openai.com'], keywords: ['chatgpt', 'openai'] },
  { name: 'Cursor', hosts: ['cursor.sh', 'cursor.com'], keywords: ['cursor'] },
  { name: 'Grok', hosts: ['grok.com', 'x.ai'], keywords: ['grok'] },
  {
    name: 'Copilot',
    hosts: ['github.com', 'vscode.dev', 'microsoft.com'],
    sharedHosts: ['global.consent.azure-apim.net'],
    keywords: ['githubcopilot', 'microsoftcopilot', 'copilotstudio', 'm365copilot'],
    exactNames: ['copilot'],
  },
];

const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '::1']);
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hostMatches(host: string, known: string): boolean {
  return host === known || host.endsWith(`.${known}`);
}

export function knownClientNameForHost(host: string | null): string | null {
  if (!host) return null;
  const normalized = host.toLowerCase();
  return KNOWN_CLIENTS.find((client) => client.hosts.includes(normalized))?.name ?? null;
}

function hostBelongsTo(host: string, client: KnownClient): boolean {
  return [...client.hosts, ...(client.sharedHosts ?? [])].some((known) => hostMatches(host, known));
}

function claimsClient(normalized: string, client: KnownClient): boolean {
  if (client.exactNames?.includes(normalized)) return true;
  return client.keywords.some((keyword) => normalized.includes(keyword));
}

function redirectTarget(uri: string): { local: boolean; host: string | null } {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { local: false, host: null };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { local: true, host: null };
  const host = url.hostname.toLowerCase();
  return { local: LOOPBACK_HOSTS.has(host) || LOOPBACK_V4.test(host), host };
}

export function impersonatedClientName(
  claimedName: string | null | undefined,
  redirectUris: readonly string[],
): string | null {
  const normalized = claimedName ? normalizeName(claimedName) : '';
  if (!normalized) return null;
  const claimed = KNOWN_CLIENTS.find((client) => claimsClient(normalized, client));
  if (!claimed) return null;
  const foreign = redirectUris.some((uri) => {
    const target = redirectTarget(uri);
    if (target.local) return false;
    return target.host === null || !hostBelongsTo(target.host, claimed);
  });
  return foreign ? claimed.name : null;
}
