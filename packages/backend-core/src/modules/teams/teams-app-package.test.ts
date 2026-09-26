import { describe, it, expect } from 'vitest';
import { crc32 } from 'node:zlib';
import { buildTeamsAppPackage, buildTeamsManifest } from './teams-app-package.ts';

const APP_ID = '11111111-2222-3333-4444-555555555555';

function readStoredZip(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(endOffset + 10);
  let central = zip.readUInt32LE(endOffset + 16);
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(central)).toBe(0x02014b50);
    const checksum = zip.readUInt32LE(central + 16);
    const size = zip.readUInt32LE(central + 20);
    const nameLength = zip.readUInt16LE(central + 28);
    const localOffset = zip.readUInt32LE(central + 42);
    const name = zip.toString('utf8', central + 46, central + 46 + nameLength);
    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26);
    const data = zip.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(checksum);
    entries.set(name, data);
    central += 46 + nameLength;
  }
  return entries;
}

describe('buildTeamsManifest', () => {
  it('declares a team-scoped bot with the RSC permission thread replies need', () => {
    const manifest = buildTeamsManifest({ appId: APP_ID, orgName: 'Acme' }) as {
      manifestVersion: string;
      id: string;
      name: { short: string; full: string };
      bots: Array<{ botId: string; scopes: string[] }>;
      webApplicationInfo: { id: string };
      authorization: { permissions: { resourceSpecific: Array<{ name: string; type: string }> } };
    };
    expect(manifest.manifestVersion).toBe('1.25');
    expect(manifest.id).toBe(APP_ID);
    expect(manifest.name.full).toBe('Munin for Acme');
    expect(manifest.bots).toEqual([
      expect.objectContaining({ botId: APP_ID, scopes: ['team'] }),
    ]);
    expect(manifest.webApplicationInfo.id).toBe(APP_ID);
    expect(manifest.authorization.permissions.resourceSpecific).toEqual([
      { name: 'ChannelMessage.Read.Group', type: 'Application' },
    ]);
  });

  it('caps the full name at the 100 characters Teams allows', () => {
    const manifest = buildTeamsManifest({ appId: APP_ID, orgName: 'x'.repeat(200) }) as {
      name: { full: string };
    };
    expect(manifest.name.full).toHaveLength(100);
  });
});

describe('buildTeamsAppPackage', () => {
  it('zips the manifest with both icons at the sizes Teams validates', () => {
    const entries = readStoredZip(buildTeamsAppPackage({ appId: APP_ID, orgName: null }));
    expect([...entries.keys()]).toEqual(['manifest.json', 'color.png', 'outline.png']);
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8')) as { id: string };
    expect(manifest.id).toBe(APP_ID);
    const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect(pngSize(entries.get('color.png')!)).toEqual([192, 192]);
    expect(pngSize(entries.get('outline.png')!)).toEqual([32, 32]);
  });
});
