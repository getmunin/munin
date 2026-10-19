export const ORG_FROM_DOMAINS_ENV = 'MUNIN_MAIL_ORG_FROM_DOMAINS';

export type OrgFromDomainPolicy =
  | { kind: 'any' }
  | { kind: 'listed'; domains: ReadonlySet<string> };

export interface ChannelAddressing {
  fromAddress: string;
  fromName?: string;
}

export interface OutboundSender {
  from: string;
  address: string;
  fallbackReplyTo?: string;
  usesDeploymentSender: boolean;
}

export interface MailerIdentity {
  readonly from: string;
}

export function readOrgFromDomainPolicy(
  raw: string | undefined = process.env[ORG_FROM_DOMAINS_ENV],
): OrgFromDomainPolicy {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => normalizeDomain(entry.trim().replace(/^@/, '')))
    .filter((entry) => entry.length > 0);
  if (entries.includes('*')) return { kind: 'any' };
  return { kind: 'listed', domains: new Set(entries) };
}

export function orgFromAddressAllowed(
  address: string,
  policy: OrgFromDomainPolicy = readOrgFromDomainPolicy(),
): boolean {
  if (policy.kind === 'any') return true;
  const domain = domainOf(address);
  return domain !== null && policy.domains.has(domain);
}

export function sharedMailerSender(
  deploymentFrom: string,
  addressing: ChannelAddressing,
  policy: OrgFromDomainPolicy = readOrgFromDomainPolicy(),
): OutboundSender {
  if (orgFromAddressAllowed(addressing.fromAddress, policy)) {
    return {
      from: composeFrom(addressing.fromName, addressing.fromAddress),
      address: addressing.fromAddress,
      usesDeploymentSender: false,
    };
  }
  const deployment = parseMailbox(deploymentFrom);
  const displayName = addressing.fromName?.trim() || deployment.name || undefined;
  return {
    from: composeFrom(displayName, deployment.address),
    address: deployment.address,
    fallbackReplyTo: addressing.fromAddress,
    usesDeploymentSender: true,
  };
}

export function channelSender(
  config: { addressing: ChannelAddressing; outbound: { provider: 'smtp' | 'mailer' } },
  deploymentFrom: string,
): OutboundSender {
  if (config.outbound.provider === 'mailer') {
    return sharedMailerSender(deploymentFrom, config.addressing);
  }
  return {
    from: composeFrom(config.addressing.fromName, config.addressing.fromAddress),
    address: config.addressing.fromAddress,
    usesDeploymentSender: false,
  };
}

export function composeFrom(name: string | undefined, address: string): string {
  const clean = name?.replace(/[",<>\r\n]/g, '').trim();
  if (!clean) return address;
  return `${clean} <${address}>`;
}

export function parseMailbox(value: string): { name: string | null; address: string } {
  const trimmed = value.trim();
  const angle = /^(.*)<\s*([^<>\s]+)\s*>\s*$/.exec(trimmed);
  if (!angle) return { name: null, address: trimmed };
  const name = angle[1]!.trim().replace(/^"(.*)"$/, '$1').trim();
  return { name: name || null, address: angle[2]! };
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const domain = normalizeDomain(address.slice(at + 1));
  return domain || null;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '');
}
