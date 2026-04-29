import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalFsStorage, S3CompatibleStorage } from './storage.js';

describe('LocalFsStorage', () => {
  let dir: string;
  let storage: LocalFsStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'munin-storage-'));
    storage = new LocalFsStorage({ rootDir: dir, publicBaseUrl: 'http://test/static' });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a file directly and resolves the public URL', async () => {
    await storage.writeDirect('a/b/hello.txt', Buffer.from('hello world'));
    const url = storage.publicUrlFor('a/b/hello.txt');
    expect(url).toBe('http://test/static/a/b/hello.txt');
    expect(await readFile(join(dir, 'a/b/hello.txt'), 'utf8')).toBe('hello world');
  });

  it('refuses to write outside rootDir', async () => {
    await expect(storage.writeDirect('../escape.txt', Buffer.from('x'))).rejects.toThrow();
  });

  it('mints a presigned upload that verifies', async () => {
    const { uploadUrl, expiresAt } = await storage.presignedUpload({
      key: 'images/logo.png',
      mime: 'image/png',
      sizeBytes: 1024,
    });
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const url = new URL(uploadUrl);
    const exp = Number(url.searchParams.get('exp'));
    const sz = Number(url.searchParams.get('sz'));
    const sig = url.searchParams.get('sig')!;
    expect(storage.verifyUploadSignature('images/logo.png', exp, sz, sig)).toBe(true);
    expect(storage.verifyUploadSignature('images/logo.png', exp, sz + 1, sig)).toBe(false);
    expect(storage.verifyUploadSignature('images/other.png', exp, sz, sig)).toBe(false);
  });

  it('delete is a no-op for missing keys', async () => {
    await expect(storage.delete('does/not/exist')).resolves.toBeUndefined();
  });

  it('returns null statBytes for missing keys', async () => {
    expect(await storage.statBytes('does/not/exist')).toBeNull();
  });

  it('returns the size for existing keys', async () => {
    await storage.writeDirect('hello-size.txt', Buffer.from('hi'));
    expect(await storage.statBytes('hello-size.txt')).toBe(2);
  });
});

describe('S3CompatibleStorage SigV4', () => {
  it('produces a deterministic-shape presigned PUT URL', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'test-bucket',
      region: 'fr-par',
      endpoint: 'https://s3.fr-par.scw.cloud',
      accessKey: 'AKIA-test',
      secretKey: 'shhh',
    });
    const { uploadUrl, publicUrl } = await s3.presignedUpload({
      key: 'images/a.png',
      mime: 'image/png',
      sizeBytes: 100,
    });
    expect(uploadUrl).toMatch(/^https:\/\/s3\.fr-par\.scw\.cloud\/test-bucket\/images\/a\.png\?/);
    expect(uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(uploadUrl).toContain('X-Amz-Signature=');
    expect(uploadUrl).toContain('X-Amz-SignedHeaders=');
    expect(publicUrl).toBe('https://s3.fr-par.scw.cloud/test-bucket/images/a.png');
  });

  it('respects publicBaseUrl override', () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'b',
      region: 'r',
      endpoint: 'https://s3.example.com',
      accessKey: 'a',
      secretKey: 's',
      publicBaseUrl: 'https://cdn.example.com',
    });
    expect(s3.publicUrlFor('hello.png')).toBe('https://cdn.example.com/hello.png');
  });
});
