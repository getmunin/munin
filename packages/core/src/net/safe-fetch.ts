import {
  lookup as dnsLookupCallback,
  type LookupAddress,
  type LookupOptions,
} from 'node:dns';
import { promisify } from 'node:util';
import { isIP as isIp } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInit as UndiciRequestInit, Response as UndiciResponse } from 'undici';
import { parseEnvBool } from '../env/index.ts';

const dnsLookup = promisify((hostname: string, cb: (err: NodeJS.ErrnoException | null, addrs: LookupAddress[]) => void) =>
  dnsLookupCallback(hostname, { all: true, verbatim: true }, cb),
);

const MAX_REDIRECTS = 5;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const x = Number(part);
    if (!Number.isInteger(x) || x < 0 || x > 255) return null;
    n = (n << 8) + x;
  }
  return n >>> 0;
}

function inCidr4(ipInt: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const baseInt = ipv4ToInt(base!);
  if (baseInt == null || !Number.isFinite(bits)) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const IPV4_PRIVATE_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().trim();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  let v4Tail: number[] | null = null;
  const lastColon = s.lastIndexOf(':');
  if (lastColon >= 0 && s.slice(lastColon + 1).includes('.')) {
    const tail = s.slice(lastColon + 1);
    const head = s.slice(0, lastColon);
    const parts = tail.split('.');
    if (parts.length !== 4) return null;
    const bytes = parts.map((p) => Number(p));
    if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
    v4Tail = [(bytes[0]! << 8) | bytes[1]!, (bytes[2]! << 8) | bytes[3]!];
    s = head;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] === '' ? [] : halves[0]!.split(':');
  const right = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : null;
  const want = 8 - (v4Tail ? 2 : 0);
  let groups: string[];
  if (right === null) {
    if (left.length !== want) return null;
    groups = left;
  } else {
    const filled = want - left.length - right.length;
    if (filled < 0) return null;
    const fill: string[] = Array<string>(filled).fill('0');
    groups = [...left, ...fill, ...right];
  }
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  if (v4Tail) out.push(...v4Tail);
  return out.length === 8 ? out : null;
}

function isPrivateIpv6(ip: string): boolean {
  const g = expandIpv6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  if ((g[0]! & 0xfe00) === 0xfc00) return true;
  if ((g[0]! & 0xffc0) === 0xfe80) return true;
  if ((g[0]! & 0xff00) === 0xff00) return true;
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = `${(g[6]! >> 8) & 0xff}.${g[6]! & 0xff}.${(g[7]! >> 8) & 0xff}.${g[7]! & 0xff}`;
    return isPrivateIp(v4);
  }
  if (g[0] === 0x2002) {
    const v4 = `${(g[1]! >> 8) & 0xff}.${g[1]! & 0xff}.${(g[2]! >> 8) & 0xff}.${g[2]! & 0xff}`;
    return isPrivateIp(v4);
  }
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const family = isIp(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true;
    return IPV4_PRIVATE_CIDRS.some((c) => inCidr4(n, c));
  }
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export interface AssertPublicHostOptions {
  resolver?: (hostname: string) => Promise<{ address: string; family: number }[]>;
}

const defaultResolver = async (
  hostname: string,
): Promise<{ address: string; family: number }[]> => {
  const records = await dnsLookup(hostname);
  return records.map((r) => ({ address: r.address, family: r.family }));
};

export async function assertPublicHost(
  hostname: string,
  opts: AssertPublicHostOptions = {},
): Promise<void> {
  await resolvePublicHost(hostname, opts);
}

export async function resolvePublicHost(
  hostname: string,
  opts: AssertPublicHostOptions = {},
): Promise<{ address: string; family: number } | null> {
  if (parseEnvBool({ name: 'MUNIN_SSRF_ALLOW_PRIVATE', default: false })) return null;
  const host = hostname.toLowerCase();
  if (!host) throw new SsrfBlockedError('empty host');
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`host "${hostname}" is not allowed`);
  }
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SsrfBlockedError(`host suffix "${hostname}" is not allowed`);
  }
  if (isIp(host)) {
    if (isPrivateIp(host)) {
      throw new SsrfBlockedError(`ip ${hostname} is private/reserved`);
    }
    return { address: host, family: isIp(host) === 6 ? 6 : 4 };
  }
  const resolver = opts.resolver ?? defaultResolver;
  let records: { address: string; family: number }[];
  try {
    records = await resolver(host);
  } catch (err) {
    throw new SsrfBlockedError(
      `dns lookup failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (records.length === 0) {
    throw new SsrfBlockedError(`dns lookup returned no records for ${hostname}`);
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new SsrfBlockedError(`host ${hostname} resolves to private ip ${r.address}`);
    }
  }
  return records[0]!;
}

function makeBlockingAgent(): Agent {
  return new Agent({
    connect: {
      lookup: (
        hostname: string,
        lookupOpts: LookupOptions,
        cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number) => void,
      ) => {
        const wantAll = lookupOpts.all === true;
        const rejectSsrf = (msg: string): void => {
          const e = new Error(msg) as NodeJS.ErrnoException;
          e.code = 'ESSRF_BLOCKED';
          cb(e, wantAll ? [] : '', 0);
        };
        const hostOk = isIp(hostname) ? !isPrivateIp(hostname) : !isBannedHostname(hostname);
        if (!hostOk && !parseEnvBool({ name: 'MUNIN_SSRF_ALLOW_PRIVATE', default: false })) {
          rejectSsrf(`host ${hostname} is not allowed`);
          return;
        }
        dnsLookupCallback(hostname, { ...lookupOpts, all: true }, (err, records) => {
          if (err) return cb(err, wantAll ? [] : '', 0);
          if (!Array.isArray(records) || records.length === 0) {
            return cb(new Error('no address resolved'), wantAll ? [] : '', 0);
          }
          if (!parseEnvBool({ name: 'MUNIN_SSRF_ALLOW_PRIVATE', default: false })) {
            for (const r of records) {
              if (isPrivateIp(r.address)) {
                return rejectSsrf(`host ${hostname} resolved to private ip ${r.address}`);
              }
            }
          }
          if (wantAll) {
            cb(null, records, 0);
          } else {
            const first = records[0]!;
            cb(null, first.address, first.family);
          }
        });
      },
    },
  });
}

function isBannedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  return false;
}

export interface SafeFetchOptions extends Omit<UndiciRequestInit, 'redirect' | 'dispatcher'> {
  resolver?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  maxRedirects?: number;
}

export async function safeFetch(input: string, init: SafeFetchOptions = {}): Promise<UndiciResponse> {
  const { resolver, maxRedirects = MAX_REDIRECTS, ...rest } = init;
  const agent = makeBlockingAgent();
  try {
    let currentUrl = input;
    let hops = 0;
    while (true) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new SsrfBlockedError(`protocol ${parsed.protocol} is not allowed`);
      }
      await assertPublicHost(parsed.hostname, { resolver });
      const res = await undiciFetch(currentUrl, {
        ...rest,
        redirect: 'manual',
        dispatcher: agent,
      });
      const status = res.status;
      const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
      if (!isRedirect) return res;
      const location = res.headers.get('location');
      if (!location) return res;
      hops += 1;
      if (hops > maxRedirects) {
        throw new SsrfBlockedError(`too many redirects (>${maxRedirects})`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      await res.body?.cancel().catch(() => {});
    }
  } finally {
    await agent.close().catch(() => {});
  }
}
