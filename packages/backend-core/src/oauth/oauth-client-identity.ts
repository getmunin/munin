export const KNOWN_HOST_NAMES: Readonly<Record<string, string>> = {
  'claude.ai': 'Claude',
  'anthropic.com': 'Claude',
  'chatgpt.com': 'ChatGPT',
  'openai.com': 'ChatGPT',
  'cursor.sh': 'Cursor',
  'cursor.com': 'Cursor',
};

interface KnownClient {
  name: string;
  hosts: string[];
  keywords: string[];
}

const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '::1']);
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildKnownClients(map: Readonly<Record<string, string>>): KnownClient[] {
  const byName = new Map<string, KnownClient>();
  for (const [host, name] of Object.entries(map)) {
    const entry = byName.get(name) ?? { name, hosts: [], keywords: [normalizeName(name)] };
    entry.hosts.push(host);
    const label = normalizeName(host.split('.')[0] ?? '');
    if (label && !entry.keywords.includes(label)) entry.keywords.push(label);
    byName.set(name, entry);
  }
  return [...byName.values()];
}

const KNOWN_CLIENTS = buildKnownClients(KNOWN_HOST_NAMES);

export function knownClientNameForHost(host: string | null): string | null {
  if (!host) return null;
  return KNOWN_HOST_NAMES[host] ?? null;
}

function hostBelongsTo(host: string, client: KnownClient): boolean {
  return client.hosts.some((known) => host === known || host.endsWith(`.${known}`));
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
  const claimed = KNOWN_CLIENTS.find((client) =>
    client.keywords.some((keyword) => normalized.includes(keyword)),
  );
  if (!claimed) return null;
  const foreign = redirectUris.some((uri) => {
    const target = redirectTarget(uri);
    if (target.local) return false;
    return target.host === null || !hostBelongsTo(target.host, claimed);
  });
  return foreign ? claimed.name : null;
}
