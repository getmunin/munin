export const CONSENT_HIDDEN_SCOPES: ReadonlySet<string> = new Set([
  'openid',
  'profile',
  'email',
  'offline_access',
  'identity:read',
]);

export const CONSENT_HIDDEN_SCOPE_PREFIXES: readonly string[] = ['mcp:'];

export const CONSENT_MODULE_ORDER = [
  'kb',
  'conv',
  'crm',
  'cms',
  'outreach',
  'social',
  'analytics',
  'commerce',
  'bookings',
  'seo',
  'connectors',
  'slack',
  'webhooks',
  'feedback',
  'system_alerts',
] as const;

export type ConsentModuleKey = (typeof CONSENT_MODULE_ORDER)[number];

export interface ConsentScopeGroup {
  module: string;
  described: boolean;
  read: boolean;
  write: boolean;
  scopes: string[];
}

export function isHiddenConsentScope(scope: string): boolean {
  if (CONSENT_HIDDEN_SCOPES.has(scope)) return true;
  return CONSENT_HIDDEN_SCOPE_PREFIXES.some((prefix) => scope.startsWith(prefix));
}

export function groupConsentScopes(scopes: readonly string[]): ConsentScopeGroup[] {
  const described = new Set<string>(CONSENT_MODULE_ORDER);
  const map = new Map<string, ConsentScopeGroup>();
  for (const scope of scopes) {
    if (isHiddenConsentScope(scope)) continue;
    const separator = scope.indexOf(':');
    const module = separator === -1 ? scope : scope.slice(0, separator);
    const action = separator === -1 ? '' : scope.slice(separator + 1);
    if (!module) continue;
    let entry = map.get(module);
    if (!entry) {
      entry = { module, described: described.has(module), read: false, write: false, scopes: [] };
      map.set(module, entry);
    }
    if (!entry.scopes.includes(scope)) entry.scopes.push(scope);
    if (action === 'read') entry.read = true;
    if (action === 'write') entry.write = true;
  }
  const ordered: ConsentScopeGroup[] = [];
  for (const module of CONSENT_MODULE_ORDER) {
    const entry = map.get(module);
    if (entry) ordered.push(entry);
  }
  for (const entry of map.values()) {
    if (!entry.described) ordered.push(entry);
  }
  return ordered;
}

export function countConsentScopes(groups: readonly ConsentScopeGroup[]): number {
  return groups.reduce((total, group) => total + group.scopes.length, 0);
}
