import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalFsStorage, S3CompatibleStorage } from './storage.ts';

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

  it('uses HMAC, not plain SHA-256, for upload signing', async () => {
    process.env.MUNIN_STORAGE_LOCAL_SECRET = 'hmac-distinct-secret';
    const sec = new LocalFsStorage({ rootDir: dir, publicBaseUrl: 'http://test/static' });
    delete process.env.MUNIN_STORAGE_LOCAL_SECRET;
    const { uploadUrl } = await sec.presignedUpload({
      key: 'k.png',
      mime: 'image/png',
      sizeBytes: 100,
    });
    const url = new URL(uploadUrl);
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    const naive = createHash('sha256')
      .update('hmac-distinct-secret').update('|')
      .update('k.png').update('|')
      .update(exp).update('|')
      .update('100')
      .digest('hex');
    expect(sig).not.toBe(naive);
  });

  it('signatures from one secret do not verify against another', async () => {
    process.env.MUNIN_STORAGE_LOCAL_SECRET = 'secret-a';
    const a = new LocalFsStorage({ rootDir: dir, publicBaseUrl: 'http://test/static' });
    process.env.MUNIN_STORAGE_LOCAL_SECRET = 'secret-b';
    const b = new LocalFsStorage({ rootDir: dir, publicBaseUrl: 'http://test/static' });
    delete process.env.MUNIN_STORAGE_LOCAL_SECRET;
    const { uploadUrl } = await a.presignedUpload({
      key: 'k.png',
      mime: 'image/png',
      sizeBytes: 50,
    });
    const url = new URL(uploadUrl);
    const exp = Number(url.searchParams.get('exp'));
    const sz = Number(url.searchParams.get('sz'));
    const sig = url.searchParams.get('sig')!;
    expect(a.verifyUploadSignature('k.png', exp, sz, sig)).toBe(true);
    expect(b.verifyUploadSignature('k.png', exp, sz, sig)).toBe(false);
  });

  it('refuses to start in production when MUNIN_STORAGE_LOCAL_SECRET is missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MUNIN_STORAGE_LOCAL_SECRET', '');
    try {
      expect(
        () => new LocalFsStorage({ rootDir: dir, publicBaseUrl: 'http://test/static' }),
      ).toThrow(/MUNIN_STORAGE_LOCAL_SECRET/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts in production when MUNIN_STORAGE_LOCAL_SECRET is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MUNIN_STORAGE_LOCAL_SECRET', 'prod-secret');
    try {
      expect(
        () => new LocalFsStorage({ rootDir: dir, publicBaseUrl: 'http://test/static' }),
      ).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('S3CompatibleStorage SigV4', () => {
  it('produces a presigned POST with policy + signature targeting the bucket root', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'test-bucket',
      region: 'fr-par',
      endpoint: 'https://s3.fr-par.scw.cloud',
      accessKey: 'AKIA-test',
      secretKey: 'shhh',
    });
    const handle = await s3.presignedUpload({
      key: 'images/a.png',
      mime: 'image/png',
      sizeBytes: 100,
    });
    expect(handle.uploadUrl).toBe('https://s3.fr-par.scw.cloud/test-bucket/');
    expect(handle.uploadMethod).toBe('POST');
    expect(handle.uploadFields.key).toBe('images/a.png');
    expect(handle.uploadFields['Content-Type']).toBe('image/png');
    expect(handle.uploadFields['x-amz-algorithm']).toBe('AWS4-HMAC-SHA256');
    expect(handle.uploadFields['x-amz-credential']).toMatch(/^AKIA-test\/\d{8}\/fr-par\/s3\/aws4_request$/);
    expect(handle.uploadFields['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(handle.uploadFields['x-amz-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(handle.uploadFields.policy).toBeTruthy();
    expect(handle.publicUrl).toBe('https://s3.fr-par.scw.cloud/test-bucket/images/a.png');
  });

  it('embeds a content-length-range condition pinned to sizeBytes', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'b',
      region: 'r',
      endpoint: 'https://s3.example.com',
      accessKey: 'a',
      secretKey: 's',
    });
    const handle = await s3.presignedUpload({ key: 'k.png', mime: 'image/png', sizeBytes: 1024 });
    const policy = JSON.parse(Buffer.from(handle.uploadFields.policy!, 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.expiration).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const range = policy.conditions.find(
      (c) => Array.isArray(c) && (c as unknown[])[0] === 'content-length-range',
    ) as [string, number, number] | undefined;
    expect(range).toBeTruthy();
    expect(range![1]).toBe(1024);
    expect(range![2]).toBe(1024);
  });

  it('signs the policy with the SigV4 derived key', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'b',
      region: 'r',
      endpoint: 'https://s3.example.com',
      accessKey: 'a',
      secretKey: 's',
    });
    const handleA = await s3.presignedUpload({ key: 'k', mime: 'image/png', sizeBytes: 100 });
    const handleB = await s3.presignedUpload({ key: 'k', mime: 'image/png', sizeBytes: 200 });
    expect(handleA.uploadFields.policy).not.toBe(handleB.uploadFields.policy);
    expect(handleA.uploadFields['x-amz-signature']).not.toBe(handleB.uploadFields['x-amz-signature']);
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

  it('statBytes signs a HEAD request and reads content-length', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'test-bucket',
      region: 'fr-par',
      endpoint: 'https://s3.fr-par.scw.cloud',
      accessKey: 'AKIA-test',
      secretKey: 'shhh',
    });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { 'content-length': '4096' },
        }),
      );
    try {
      const size = await s3.statBytes('images/a.png');
      expect(size).toBe(4096);
      expect(spy).toHaveBeenCalledOnce();
      const [calledUrlArg, calledInit] = spy.mock.calls[0]!;
      const calledHref =
        typeof calledUrlArg === 'string'
          ? calledUrlArg
          : calledUrlArg instanceof URL
            ? calledUrlArg.href
            : String((calledUrlArg as { url: string }).url);
      expect(calledHref).toMatch(
        /^https:\/\/s3\.fr-par\.scw\.cloud\/test-bucket\/images\/a\.png\?/,
      );
      expect(calledHref).toContain('X-Amz-Signature=');
      expect(calledInit?.method).toBe('HEAD');
    } finally {
      spy.mockRestore();
    }
  });

  it('statBytes returns null on 404/403', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'b',
      region: 'r',
      endpoint: 'https://s3.example.com',
      accessKey: 'a',
      secretKey: 's',
    });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    try {
      expect(await s3.statBytes('missing')).toBeNull();
      expect(await s3.statBytes('denied')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('writeDirect sends a SigV4-signed PUT with hashed payload', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'test-bucket',
      region: 'fr-par',
      endpoint: 'https://s3.fr-par.scw.cloud',
      accessKey: 'AKIA-test',
      secretKey: 'shhh',
    });
    const body = Buffer.from('hello-binary-bytes');
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    try {
      await s3.writeDirect('images/a.png', body, { mime: 'image/png' });
      expect(spy).toHaveBeenCalledOnce();
      const [calledUrlArg, calledInit] = spy.mock.calls[0]!;
      const href =
        typeof calledUrlArg === 'string'
          ? calledUrlArg
          : calledUrlArg instanceof URL
            ? calledUrlArg.href
            : String((calledUrlArg as { url: string }).url);
      expect(href).toBe('https://s3.fr-par.scw.cloud/test-bucket/images/a.png');
      expect(calledInit?.method).toBe('PUT');
      expect(calledInit?.body).toBe(body);
      const headers = calledInit?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('image/png');
      expect(headers['Content-Length']).toBe(String(body.length));
      const expectedHash = createHash('sha256').update(body).digest('hex');
      expect(headers['x-amz-content-sha256']).toBe(expectedHash);
      expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(headers['Authorization']).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIA-test\/\d{8}\/fr-par\/s3\/aws4_request, SignedHeaders=content-length;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('writeDirect throws on non-2xx response', async () => {
    const s3 = new S3CompatibleStorage({
      bucket: 'b',
      region: 'r',
      endpoint: 'https://s3.example.com',
      accessKey: 'a',
      secretKey: 's',
    });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('AccessDenied', { status: 403 }));
    try {
      await expect(s3.writeDirect('x', Buffer.from('y'))).rejects.toThrow(/s3 put failed: 403/);
    } finally {
      spy.mockRestore();
    }
  });
});
