import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication, NestApplicationOptions, Type } from '@nestjs/common';
import { LocalFsStorage, type AssetStorage } from '@getmunin/core';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { STORAGE } from './common/storage/storage.token.js';

const DEFAULT_DEV_WEB_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Hashed widget bundles match `widget.<12-hex-sha>.js[.map]?`. Anything
 * else hitting `/widget/...` is rejected with 404 — no path traversal
 * surface, no accidental directory listing.
 */
const HASHED_WIDGET_FILE_RE = /^widget\.[a-f0-9]{12}\.js(\.map)?$/;

function readAllowedOrigins(): string[] | true {
  const env = process.env.MUNIN_CORS_ORIGINS;
  if (!env) return DEFAULT_DEV_WEB_ORIGINS;
  if (env === '*') return true;
  return env.split(',').map((s) => s.trim()).filter(Boolean);
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
  const { widgetAssetDir, ...nestOpts } = opts;
  const app = await NestFactory.create(appModule, { rawBody: true, ...nestOpts });
  app.use(corsMiddleware(readAllowedOrigins()));
  app.use(requestIdMiddleware);

  // Static-asset GET handler. Active only when the storage provider is
  // local; in S3 mode reads go directly to the bucket's public host.
  const storage = app.get<AssetStorage>(STORAGE);
  if (storage instanceof LocalFsStorage) {
    app.use('/static/assets', staticAssetsMiddleware(storage));
  }

  const resolvedWidgetDir = resolve(widgetAssetDir ?? join(process.cwd(), 'public', 'widget'));
  app.use('/widget.js', widgetRedirectMiddleware(resolvedWidgetDir));
  app.use('/widget', widgetBundleMiddleware(resolvedWidgetDir));

  return app;
}

function isPublicWidgetPath(path: string): boolean {
  return (
    path === '/widget.js' ||
    path.startsWith('/widget/') ||
    path.startsWith('/api/v1/widget')
  );
}

function corsMiddleware(strictOrigins: string[] | true) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const allowAny = isPublicWidgetPath(req.path);
    const allowed =
      origin !== undefined &&
      (allowAny || strictOrigins === true || strictOrigins.includes(origin));

    if (allowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
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
    case 'svg':
      return 'image/svg+xml';
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
