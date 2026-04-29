import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication, NestApplicationOptions, Type } from '@nestjs/common';
import { LocalFsStorage, type AssetStorage } from '@munin/core';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { STORAGE } from './common/storage/storage.token.js';

const DEFAULT_DEV_WEB_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function readAllowedOrigins(): string[] | true {
  const env = process.env.MUNIN_CORS_ORIGINS;
  if (!env) return DEFAULT_DEV_WEB_ORIGINS;
  if (env === '*') return true;
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Boot the Nest app with all the Express-level concerns wired up:
 *   - CORS for the dashboard origins.
 *   - Static-asset GET handler for self-host (LocalFsStorage) — read by
 *     external clients via the URL the storage provider returns from
 *     `publicUrlFor()`.
 *
 * The caller supplies their AppModule (single-tenant for OSS, multi-tenant
 * for cloud). Both editions go through this factory so tests, prod, and
 * dev all share the same boot shape.
 */
export async function createApp(
  appModule: Type<unknown>,
  opts: NestApplicationOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(appModule, opts);
  app.enableCors({
    origin: readAllowedOrigins(),
    credentials: true,
  });

  // Static-asset GET handler. Active only when the storage provider is
  // local; in S3 mode reads go directly to the bucket's public host.
  const storage = app.get<AssetStorage>(STORAGE);
  if (storage instanceof LocalFsStorage) {
    app.use('/static/assets', staticAssetsMiddleware(storage));
  }

  return app;
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
