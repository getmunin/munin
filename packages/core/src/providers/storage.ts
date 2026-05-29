import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';

export interface PresignedUploadHandle {
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadFields: Record<string, string>;
  publicUrl: string;
  expiresAt: Date;
}

export interface AssetStorage {
  readonly provider: 'local' | 's3';

  presignedUpload(opts: {
    key: string;
    mime: string;
    sizeBytes: number;
  }): Promise<PresignedUploadHandle>;

  delete(key: string): Promise<void>;

  publicUrlFor(key: string): string;

  writeDirect?(key: string, body: Buffer): Promise<void>;

  statBytes(key: string): Promise<number | null>;
}

export interface LocalFsStorageOptions {
  rootDir: string;
  publicBaseUrl: string;
  uploadTtlMs?: number;
}

const DEFAULT_UPLOAD_TTL_MS = 15 * 60 * 1000;

export class LocalFsStorage implements AssetStorage {
  readonly provider = 'local';
  readonly rootDir: string;
  readonly publicBaseUrl: string;
  private readonly uploadTtlMs: number;
  private readonly secret: string;

  constructor(opts: LocalFsStorageOptions) {
    this.rootDir = resolve(opts.rootDir);
    this.publicBaseUrl = opts.publicBaseUrl.replace(/\/+$/, '');
    this.uploadTtlMs = opts.uploadTtlMs ?? DEFAULT_UPLOAD_TTL_MS;
    const fromEnv = process.env.MUNIN_STORAGE_LOCAL_SECRET;
    if (!fromEnv && process.env.NODE_ENV === 'production') {
      throw new Error(
        'MUNIN_STORAGE_LOCAL_SECRET must be set when NODE_ENV=production with provider=local',
      );
    }
    this.secret = fromEnv ?? 'dev-local-storage-secret';
  }

  presignedUpload(opts: {
    key: string;
    mime: string;
    sizeBytes: number;
  }): Promise<PresignedUploadHandle> {
    const key = sanitizeKey(opts.key);
    const expiresAt = new Date(Date.now() + this.uploadTtlMs);
    const expiresAtMs = expiresAt.getTime();
    const sig = signLocalUpload(this.secret, key, expiresAtMs, opts.sizeBytes);
    const uploadUrl = `${this.publicBaseUrl}/upload?key=${encodeURIComponent(key)}&exp=${expiresAtMs}&sz=${opts.sizeBytes}&sig=${sig}`;
    const publicUrl = this.publicUrlFor(key);
    return Promise.resolve({
      uploadUrl,
      uploadMethod: 'PUT' as const,
      uploadFields: {},
      publicUrl,
      expiresAt,
    });
  }

  publicUrlFor(key: string): string {
    return `${this.publicBaseUrl}/${sanitizeKey(key)}`;
  }

  async writeDirect(key: string, body: Buffer): Promise<void> {
    const safeKey = sanitizeKey(key);
    const fullPath = join(this.rootDir, safeKey);
    if (!fullPath.startsWith(this.rootDir)) {
      throw new Error(`local storage: refusing to write outside rootDir: ${safeKey}`);
    }
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body);
  }

  async delete(key: string): Promise<void> {
    const safeKey = sanitizeKey(key);
    const fullPath = join(this.rootDir, safeKey);
    if (!fullPath.startsWith(this.rootDir)) return;
    await rm(fullPath, { force: true });
  }

  async statBytes(key: string): Promise<number | null> {
    const safeKey = sanitizeKey(key);
    const fullPath = join(this.rootDir, safeKey);
    if (!fullPath.startsWith(this.rootDir)) return null;
    try {
      const s = await stat(fullPath);
      return s.size;
    } catch {
      return null;
    }
  }

  verifyUploadSignature(key: string, expiresAtMs: number, sizeBytes: number, sig: string): boolean {
    if (Date.now() > expiresAtMs) return false;
    const expected = signLocalUpload(this.secret, sanitizeKey(key), expiresAtMs, sizeBytes);
    return timingSafeEqualString(sig, expected);
  }
}

export interface S3CompatibleStorageOptions {
  bucket: string;
  region: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl?: string;
  uploadTtlSeconds?: number;
}

const DEFAULT_S3_UPLOAD_TTL_SECONDS = 15 * 60;

export class S3CompatibleStorage implements AssetStorage {
  readonly provider = 's3';
  readonly bucket: string;
  readonly region: string;
  readonly endpoint: string;
  readonly publicBaseUrl: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly uploadTtlSeconds: number;

  constructor(opts: S3CompatibleStorageOptions) {
    this.bucket = opts.bucket;
    this.region = opts.region;
    this.endpoint = opts.endpoint.replace(/\/+$/, '');
    this.accessKey = opts.accessKey;
    this.secretKey = opts.secretKey;
    this.publicBaseUrl = (opts.publicBaseUrl ?? `${this.endpoint}/${this.bucket}`).replace(/\/+$/, '');
    this.uploadTtlSeconds = opts.uploadTtlSeconds ?? DEFAULT_S3_UPLOAD_TTL_SECONDS;
  }

  presignedUpload(opts: {
    key: string;
    mime: string;
    sizeBytes: number;
  }): Promise<PresignedUploadHandle> {
    const key = sanitizeKey(opts.key);
    const expiresAt = new Date(Date.now() + this.uploadTtlSeconds * 1000);
    const { uploadUrl, uploadFields } = this.signPostPolicy(key, opts.mime, opts.sizeBytes, expiresAt);
    return Promise.resolve({
      uploadUrl,
      uploadMethod: 'POST' as const,
      uploadFields,
      publicUrl: this.publicUrlFor(key),
      expiresAt,
    });
  }

  publicUrlFor(key: string): string {
    return `${this.publicBaseUrl}/${sanitizeKey(key)}`;
  }

  async delete(key: string): Promise<void> {
    const safeKey = sanitizeKey(key);
    const url = this.signDeleteUrl(safeKey);
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`s3 delete failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  }

  async statBytes(key: string): Promise<number | null> {
    const safeKey = sanitizeKey(key);
    const url = this.signedUrl('HEAD', safeKey, 60, {});
    const res = await fetch(url, { method: 'HEAD' });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) {
      throw new Error(`s3 head failed: ${res.status}`);
    }
    const lenHeader = res.headers.get('content-length');
    if (!lenHeader) return null;
    const n = Number(lenHeader);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  private signPostPolicy(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresAt: Date,
  ): { uploadUrl: string; uploadFields: Record<string, string> } {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const credential = `${this.accessKey}/${credentialScope}`;
    const policyDoc = {
      expiration: expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      conditions: [
        { bucket: this.bucket },
        { key },
        { 'Content-Type': contentType },
        ['content-length-range', sizeBytes, sizeBytes],
        { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
        { 'x-amz-credential': credential },
        { 'x-amz-date': amzDate },
      ],
    };
    const policyB64 = Buffer.from(JSON.stringify(policyDoc), 'utf8').toString('base64');
    const signingKey = deriveSigningKey(this.secretKey, dateStamp, this.region, 's3');
    const signature = hmacHex(signingKey, policyB64);
    return {
      uploadUrl: `${this.endpoint}/${this.bucket}/`,
      uploadFields: {
        key,
        'Content-Type': contentType,
        policy: policyB64,
        'x-amz-algorithm': 'AWS4-HMAC-SHA256',
        'x-amz-credential': credential,
        'x-amz-date': amzDate,
        'x-amz-signature': signature,
      },
    };
  }

  private signDeleteUrl(key: string): string {
    return this.signedUrl('DELETE', key, 60, {});
  }

  private signedUrl(
    method: string,
    key: string,
    expiresIn: number,
    signedHeaders: Record<string, string>,
  ): string {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const url = new URL(`${this.endpoint}/${this.bucket}/${key}`);
    const host = url.host;

    const headerNamesToSign = ['host', ...Object.keys(signedHeaders).map((h) => h.toLowerCase())].sort();
    const signedHeadersList = headerNamesToSign.join(';');

    const queryParams = new URLSearchParams();
    queryParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    queryParams.set('X-Amz-Credential', `${this.accessKey}/${credentialScope}`);
    queryParams.set('X-Amz-Date', amzDate);
    queryParams.set('X-Amz-Expires', String(expiresIn));
    queryParams.set('X-Amz-SignedHeaders', signedHeadersList);

    const sortedQuery = [...queryParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
      .join('&');

    const canonicalHeaders =
      headerNamesToSign
        .map((h) => `${h}:${h === 'host' ? host : signedHeaders[h]}`)
        .join('\n') + '\n';
    const canonicalRequest = [
      method,
      url.pathname,
      sortedQuery,
      canonicalHeaders,
      signedHeadersList,
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = deriveSigningKey(this.secretKey, dateStamp, this.region, 's3');
    const signature = hmacHex(signingKey, stringToSign);

    return `${url.origin}${url.pathname}?${sortedQuery}&X-Amz-Signature=${signature}`;
  }
}

export function readAssetStorageFromEnv(): AssetStorage {
  const provider = (process.env.MUNIN_STORAGE_PROVIDER ?? 'local').toLowerCase();
  if (provider === 's3') {
    const bucket = process.env.MUNIN_STORAGE_S3_BUCKET;
    const region = process.env.MUNIN_STORAGE_S3_REGION;
    const endpoint = process.env.MUNIN_STORAGE_S3_ENDPOINT;
    const accessKey = process.env.MUNIN_STORAGE_S3_ACCESS_KEY;
    const secretKey = process.env.MUNIN_STORAGE_S3_SECRET_KEY;
    if (!bucket || !region || !endpoint || !accessKey || !secretKey) {
      throw new Error(
        'MUNIN_STORAGE_PROVIDER=s3 requires MUNIN_STORAGE_S3_{BUCKET,REGION,ENDPOINT,ACCESS_KEY,SECRET_KEY}',
      );
    }
    return new S3CompatibleStorage({
      bucket,
      region,
      endpoint,
      accessKey,
      secretKey,
      publicBaseUrl: process.env.MUNIN_STORAGE_S3_PUBLIC_BASE_URL,
    });
  }
  return new LocalFsStorage({
    rootDir: process.env.MUNIN_STORAGE_LOCAL_PATH ?? '/var/munin/assets',
    publicBaseUrl:
      process.env.MUNIN_STORAGE_LOCAL_BASE_URL ?? 'http://localhost:3001/static/assets',
  });
}

function sanitizeKey(key: string): string {
  const normalized = normalize(key.replace(/\\+/g, '/')).replace(/^\/+/, '');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return normalized;
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

function hmacBuffer(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function deriveSigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacBuffer(`AWS4${secret}`, dateStamp);
  const kRegion = hmacBuffer(kDate, region);
  const kService = hmacBuffer(kRegion, service);
  return hmacBuffer(kService, 'aws4_request');
}

function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function signLocalUpload(secret: string, key: string, expiresAtMs: number, sizeBytes: number): string {
  return createHmac('sha256', secret)
    .update(`${key}|${expiresAtMs}|${sizeBytes}`)
    .digest('hex');
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
