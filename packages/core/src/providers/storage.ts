import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';

/**
 * Asset storage abstraction. Pluggable so self-hosters can run on local
 * filesystem (default — works inside `docker compose up`) and production
 * deployments use any S3-compatible service (AWS S3, Cloudflare R2, MinIO).
 *
 * The abstraction is *thin* on purpose: callers ask for a presigned-upload
 * pair (upload URL + public URL) and either delete keys or look up public
 * URLs. Image transforms / resizing are explicitly out of scope; if you
 * need them, sit a CDN with image-transform features (Cloudflare Images,
 * Imgix, …) in front of the storage bucket.
 */
export interface AssetStorage {
  /** Provider identifier persisted on cms_assets.storage_provider. */
  readonly provider: 'local' | 's3';

  /**
   * Mint a (uploadUrl, publicUrl) pair for a fresh storage key. The
   * caller is expected to PUT the file body to `uploadUrl` within
   * `expiresAt`, then call cms_complete_asset_upload to mark the row
   * as live.
   */
  presignedUpload(opts: {
    key: string;
    mime: string;
    sizeBytes: number;
  }): Promise<{ uploadUrl: string; publicUrl: string; expiresAt: Date }>;

  /** Delete an object by key. No-op if it doesn't exist. */
  delete(key: string): Promise<void>;

  /** Resolve a public read URL for an object without minting an upload. */
  publicUrlFor(key: string): string;

  /**
   * For LocalFsStorage: write a buffer to the storage key directly. Used
   * by the static-assets controller in self-host mode (the dashboard /
   * agents POST a multipart body, the controller forwards to this). S3
   * impl throws — uploaders go to the presigned URL instead.
   */
  writeDirect?(key: string, body: Buffer): Promise<void>;

  /** Best-effort size-on-disk lookup; used to verify the upload landed. */
  statBytes?(key: string): Promise<number | null>;
}

// ─── Local filesystem ────────────────────────────────────────────────────────

export interface LocalFsStorageOptions {
  /** Filesystem directory the storage root lives under. */
  rootDir: string;
  /** Public base URL the static-assets controller serves from. */
  publicBaseUrl: string;
  /** TTL for presigned upload URLs. Default 15 min. */
  uploadTtlMs?: number;
}

const DEFAULT_UPLOAD_TTL_MS = 15 * 60 * 1000;

/**
 * Writes objects to a directory on disk and serves them through a Munin-
 * hosted static handler. Default for self-host (`docker compose up`).
 *
 * The "presigned" upload URL is just a signed POST to the static-assets
 * controller; the signature is a token derived from the storage key +
 * MUNIN_STORAGE_LOCAL_SECRET so an attacker can't write to arbitrary keys
 * even if they know the route. (Falls back to a random token if no secret
 * is configured.)
 */
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
    this.secret = process.env.MUNIN_STORAGE_LOCAL_SECRET ?? 'dev-local-storage-secret';
  }

  presignedUpload(opts: {
    key: string;
    mime: string;
    sizeBytes: number;
  }): Promise<{ uploadUrl: string; publicUrl: string; expiresAt: Date }> {
    const key = sanitizeKey(opts.key);
    const expiresAt = new Date(Date.now() + this.uploadTtlMs);
    const expiresAtMs = expiresAt.getTime();
    const sig = signLocalUpload(this.secret, key, expiresAtMs, opts.sizeBytes);
    const uploadUrl = `${this.publicBaseUrl}/upload?key=${encodeURIComponent(key)}&exp=${expiresAtMs}&sz=${opts.sizeBytes}&sig=${sig}`;
    const publicUrl = this.publicUrlFor(key);
    return Promise.resolve({ uploadUrl, publicUrl, expiresAt });
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

  /** Verify an upload signature. Used by the static-assets controller. */
  verifyUploadSignature(key: string, expiresAtMs: number, sizeBytes: number, sig: string): boolean {
    if (Date.now() > expiresAtMs) return false;
    const expected = signLocalUpload(this.secret, sanitizeKey(key), expiresAtMs, sizeBytes);
    return timingSafeEqualString(sig, expected);
  }
}

// ─── S3-compatible ───────────────────────────────────────────────────────────

export interface S3CompatibleStorageOptions {
  bucket: string;
  region: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
  /**
   * Public base URL for read access (CDN front, bucket policy, or proxy).
   * If omitted, falls back to the path-style URL on `endpoint`.
   */
  publicBaseUrl?: string;
  uploadTtlSeconds?: number;
}

const DEFAULT_S3_UPLOAD_TTL_SECONDS = 15 * 60;

/**
 * S3-compatible storage. Builds presigned PUT URLs using AWS SigV4 — the
 * same protocol AWS S3, Cloudflare R2, and MinIO all speak. Implemented
 * inline (no `@aws-sdk/*` dep) so the package stays lightweight; SigV4 is
 * well-documented and stable.
 *
 * Uploaders PUT to `uploadUrl` with the file body and `Content-Type`
 * matching `mime`; reads use `publicUrl`.
 */
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
  }): Promise<{ uploadUrl: string; publicUrl: string; expiresAt: Date }> {
    const key = sanitizeKey(opts.key);
    const url = this.signPutUrl(key, opts.mime);
    const expiresAt = new Date(Date.now() + this.uploadTtlSeconds * 1000);
    return Promise.resolve({ uploadUrl: url, publicUrl: this.publicUrlFor(key), expiresAt });
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

  // ─── SigV4 implementation ────────────────────────────────────────────────

  private signPutUrl(key: string, contentType: string): string {
    return this.signedUrl('PUT', key, this.uploadTtlSeconds, { 'content-type': contentType });
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

// ─── env factory ─────────────────────────────────────────────────────────────

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

// ─── helpers ─────────────────────────────────────────────────────────────────

function sanitizeKey(key: string): string {
  // Normalize separators, drop leading slashes, reject `..` traversal.
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
  return createHash('sha256')
    .update(secret)
    .update('|')
    .update(key)
    .update('|')
    .update(String(expiresAtMs))
    .update('|')
    .update(String(sizeBytes))
    .digest('hex');
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
