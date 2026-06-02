import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication, NestApplicationOptions, Type } from '@nestjs/common';
import { LocalFsStorage, type AssetStorage } from '@getmunin/core';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { STORAGE } from './common/storage/storage.token.ts';

const DEFAULT_DEV_WEB_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Hashed widget bundles match `widget.<12-hex-sha>.js[.map]?`. Anything
 * else hitting `/widget/...` is rejected with 404 — no path traversal
 * surface, no accidental directory listing.
 */
const HASHED_WIDGET_FILE_RE = /^widget\.[a-f0-9]{12}\.js(\.map)?$/;

export function readAllowedOrigins(): string[] | true {
  const env = process.env.MUNIN_CORS_ORIGINS;
  if (!env) return DEFAULT_DEV_WEB_ORIGINS;
  if (env === '*') return true;
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

function readAllowedHosts(): string[] | null {
  const env = process.env.MUNIN_ALLOWED_HOSTS;
  if (!env) return null;
  return env.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function readTrustProxySetting(): boolean | number | string | null {
  const raw = process.env.MUNIN_TRUST_PROXY?.trim();
  if (!raw) return null;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return null;
  const n = Number(raw);
  if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) return n;
  return raw;
}

export interface CreateAppOptions extends NestApplicationOptions {
  /**
   * Absolute path to the directory holding the chat-widget's hashed
   * bundle + manifest.json. Defaults to `<cwd>/public/widget` which
   * matches `apps/backend/public/widget/` after the prebuild copy step.
   * Pass an explicit path for tests or alternative layouts. If the
   * directory doesn't exist at boot, the routes log a one-line warning
   * and serve 503 — the rest of the API still boots.
   */
  widgetAssetDir?: string;
  /**
   * Absolute path to the directory holding the MCP host's brand icons —
   * `favicon.ico`, `icon.png`, `apple-icon.png`. Served at the root paths
   * `/favicon.ico`, `/icon.png`, `/apple-icon.png` with a long cache.
   * Defaults to `<cwd>/public/icons`. Missing files silently 404; this
   * is what claude.ai web (and similar MCP UIs) fetches to render the
   * custom-integration tile.
   */
  iconAssetDir?: string;
}

/**
 * Boot the Nest app with all the Express-level concerns wired up:
 *   - CORS for the dashboard origins.
 *   - Static-asset GET handler for self-host (LocalFsStorage) — read by
 *     external clients via the URL the storage provider returns from
 *     `publicUrlFor()`.
 *   - Chat-widget bundle: `/widget/<sha>.js` (immutable, year-long cache)
 *     and `/widget.js` (302 redirect to the current sha, short cache).
 *
 * The caller supplies their AppModule (single-tenant for OSS, multi-tenant
 * for cloud). Both editions go through this factory so tests, prod, and
 * dev all share the same boot shape.
 */
export async function createApp(
  appModule: Type<unknown>,
  opts: CreateAppOptions = {},
): Promise<INestApplication> {
  const { widgetAssetDir, iconAssetDir, ...nestOpts } = opts;
  const app = await NestFactory.create(appModule, { rawBody: true, ...nestOpts });
  const trustProxy = readTrustProxySetting();
  if (trustProxy !== null) {
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
      'trust proxy',
      trustProxy,
    );
  }
  const allowedHosts = readAllowedHosts();
  if (allowedHosts) app.use(hostAllowlistMiddleware(allowedHosts));
  app.use(publicUrlRewriteMiddleware());
  app.use(corsMiddleware(readAllowedOrigins()));
  app.use(requestIdMiddleware);

  const storage = app.get<AssetStorage>(STORAGE);
  if (storage instanceof LocalFsStorage) {
    app.use('/static/assets', staticAssetsMiddleware(storage));
  }

  const resolvedWidgetDir = resolve(widgetAssetDir ?? join(process.cwd(), 'public', 'widget'));
  app.use('/widget.js', widgetRedirectMiddleware(resolvedWidgetDir));
  app.use('/widget', widgetBundleMiddleware(resolvedWidgetDir));

  const resolvedIconDir = resolve(iconAssetDir ?? join(process.cwd(), 'public', 'icons'));
  app.use(brandIconMiddleware(resolvedIconDir));

  return app;
}

export function isPublicCorsPath(path: string): boolean {
  return (
    path === '/widget.js' ||
    path.startsWith('/widget/') ||
    path.startsWith('/v1/widget') ||
    path === '/mcp' ||
    path.startsWith('/mcp/') ||
    path.startsWith('/.well-known/oauth-') ||
    path.startsWith('/.well-known/openid-') ||
    path.startsWith('/v1/oauth/clients/')
  );
}

/**
 * Maps the canonical MCP URL onto the internal `/mcp` Nest mount.
 *
 * A cloud deploy can advertise `https://mcp.getmunin.com` (no path) and
 * the middleware rewrites root requests on that host to `/mcp` so the
 * MCP controller sees them. OSS dev keeps `/mcp` → `/mcp` (no-op since
 * `NEXT_PUBLIC_MCP_URL=http://localhost:3001/mcp` matches the internal
 * path verbatim).
 */
export function publicUrlRewriteMiddleware() {
  const mcp = parseRewriteSource(process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp');
  return (req: Request, _res: Response, next: NextFunction): void => {
    const rawHost = typeof req.headers.host === 'string' ? req.headers.host : '';
    const host = rawHost.split(':', 1)[0]!.toLowerCase();
    rewriteIfMatch(req, host, mcp, '/mcp');
    next();
  };
}

interface RewriteSource {
  host: string;
  externalPath: string;
}

function parseRewriteSource(raw: string | undefined): RewriteSource | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, '');
    return { host: u.hostname.toLowerCase(), externalPath: path };
  } catch {
    return null;
  }
}

function rewriteIfMatch(
  req: Request,
  host: string,
  src: RewriteSource | null,
  internal: string,
): void {
  if (!src) return;
  if (src.host !== host) return;
  if (src.externalPath === internal) return;

  const [path, qs] = splitQuery(req.url ?? '/');
  if (src.externalPath === '') {
    if (path === '/' || path === '') {
      req.url = internal + (qs ? `?${qs}` : '');
    }
    return;
  }
  if (path === src.externalPath) {
    req.url = internal + (qs ? `?${qs}` : '');
  } else if (path.startsWith(`${src.externalPath}/`)) {
    req.url = `${internal}${path.slice(src.externalPath.length)}${qs ? `?${qs}` : ''}`;
  }
}

function splitQuery(url: string): [string, string] {
  const i = url.indexOf('?');
  return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i + 1)];
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function parseHostHeader(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close > 0) return raw.slice(1, close).toLowerCase();
    return '';
  }
  return raw.split(':', 1)[0]!.toLowerCase();
}

export function hostAllowlistMiddleware(allowedHosts: string[]) {
  const allowed = new Set(allowedHosts);
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = typeof req.headers.host === 'string' ? req.headers.host : '';
    const host = parseHostHeader(raw);
    if (!host || (!allowed.has(host) && !LOOPBACK_HOSTS.has(host))) {
      res.status(421).json({ error: 'misdirected_request' });
      return;
    }
    next();
  };
}

export function corsMiddleware(strictOrigins: string[] | true) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const allowAny = isPublicCorsPath(req.path);
    const allowed =
      origin !== undefined &&
      (allowAny || strictOrigins === true || strictOrigins.includes(origin));

    if (allowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      const explicitlyAllowed = !allowAny && Array.isArray(strictOrigins) && strictOrigins.includes(origin);
      if (explicitlyAllowed) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.setHeader('Access-Control-Expose-Headers', 'x-request-id');
    }

    if (req.method === 'OPTIONS') {
      if (allowed) {
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
        const reqHeaders = req.headers['access-control-request-headers'];
        if (typeof reqHeaders === 'string') {
          res.setHeader('Access-Control-Allow-Headers', reqHeaders);
        }
        res.setHeader('Access-Control-Max-Age', '86400');
      }
      res.status(204).end();
      return;
    }
    next();
  };
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = typeof candidate === 'string' && REQUEST_ID_RE.test(candidate) ? candidate : randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

function staticAssetsMiddleware(storage: LocalFsStorage) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    // Skip the upload endpoint — handled by the StaticAssetsController.
    if (req.path === '/upload' || req.path.startsWith('/upload?')) {
      next();
      return;
    }
    const key = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (!key || key.includes('..')) {
      res.status(404).end();
      return;
    }
    const filePath = resolve(join(storage.rootDir, key));
    if (!filePath.startsWith(storage.rootDir)) {
      res.status(404).end();
      return;
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        res.status(404).end();
        return;
      }
      res.setHeader('content-length', String(info.size));
      res.setHeader('content-type', guessMime(key));
      res.setHeader('cache-control', 'public, max-age=300, stale-while-revalidate=86400');
      res.setHeader('etag', `"${info.mtimeMs.toFixed(0)}-${info.size}"`);
      res.setHeader('x-content-type-options', 'nosniff');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch {
      res.status(404).end();
    }
  };
}

/**
 * In-memory cache of `manifest.json`. Refreshes when the file's mtime
 * changes so a deploy that swaps the manifest in-place picks up without
 * a server restart. Returns `null` if the manifest is missing or
 * malformed — the route handlers translate that to a 503.
 */
function manifestReader(widgetDir: string): () => Promise<{ current: string } | null> {
  let cached: { current: string } | null = null;
  let cachedMtime = -1;
  return async () => {
    const path = join(widgetDir, 'manifest.json');
    try {
      const info = await stat(path);
      if (info.mtimeMs !== cachedMtime) {
        const raw = await readFile(path, 'utf8');
        const parsed = JSON.parse(raw) as { current?: unknown };
        if (typeof parsed.current === 'string' && HASHED_WIDGET_FILE_RE.test(parsed.current)) {
          cached = { current: parsed.current };
          cachedMtime = info.mtimeMs;
        } else {
          cached = null;
          cachedMtime = -1;
        }
      }
    } catch {
      cached = null;
      cachedMtime = -1;
    }
    return cached;
  };
}

function widgetRedirectMiddleware(widgetDir: string) {
  const readManifest = manifestReader(widgetDir);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const manifest = await readManifest();
    if (!manifest) {
      res.setHeader('cache-control', 'no-store');
      res.status(503).end();
      return;
    }
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'public, max-age=300, must-revalidate');
    res.redirect(302, `/widget/${manifest.current}`);
  };
}

function widgetBundleMiddleware(widgetDir: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const file = req.path.replace(/^\/+/, '');
    if (!HASHED_WIDGET_FILE_RE.test(file)) {
      res.status(404).end();
      return;
    }
    const filePath = resolve(join(widgetDir, file));
    if (!filePath.startsWith(resolve(widgetDir))) {
      res.status(404).end();
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).end();
      return;
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        res.status(404).end();
        return;
      }
      res.setHeader('content-length', String(info.size));
      res.setHeader(
        'content-type',
        file.endsWith('.map')
          ? 'application/json; charset=utf-8'
          : 'application/javascript; charset=utf-8',
      );
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch {
      res.status(404).end();
    }
  };
}

const BRAND_ICON_FILES: Record<string, string> = {
  '/favicon.ico': 'favicon.ico',
  '/icon.png': 'icon.png',
  '/apple-icon.png': 'apple-icon.png',
};

function brandIconMiddleware(iconDir: string) {
  const root = resolve(iconDir);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const file = BRAND_ICON_FILES[req.path];
    if (!file) {
      next();
      return;
    }
    const filePath = resolve(join(root, file));
    if (!filePath.startsWith(root)) {
      res.status(404).end();
      return;
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        res.status(404).end();
        return;
      }
      res.setHeader('content-length', String(info.size));
      res.setHeader('content-type', file.endsWith('.ico') ? 'image/x-icon' : 'image/png');
      res.setHeader('cache-control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('access-control-allow-origin', '*');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch {
      res.status(404).end();
    }
  };
}

function guessMime(key: string): string {
  const ext = key.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'md':
      return 'text/markdown; charset=utf-8';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}
