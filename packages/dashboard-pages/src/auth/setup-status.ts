export interface MembershipDto {
  orgId: string;
  name: string;
  role: string;
  isDefault: boolean;
}

export interface AgentConfigStatusDto {
  providerConfigured: boolean;
}

export function isSetupIncomplete(
  config: AgentConfigStatusDto | null,
  memberships: MembershipDto[] | null,
): boolean {
  if (!config || !memberships) return false;

  const active = memberships.find((m) => m.isDefault) ?? memberships[0] ?? null;
  if (!active) return false;
  if (active.role !== 'owner' && active.role !== 'admin') return false;

  return !config.providerConfigured || active.name.trim().length === 0;
}
