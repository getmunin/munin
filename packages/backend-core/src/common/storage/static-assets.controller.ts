import {
  BadRequestException,
  ForbiddenException,
  Inject,
  NotFoundException,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { LocalFsStorage, type AssetStorage } from '@getmunin/core';
import type { Request, Response } from 'express';

import { PublicController } from '../auth/auth.guard.ts';
import { STORAGE } from './storage.token.ts';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@PublicController('static/assets')
export class StaticAssetsController {
  constructor(@Inject(STORAGE) private readonly storage: AssetStorage) {}

  @Post('upload')
  postUpload(
    @Req() req: Request,
    @Res() res: Response,
    @Query('key') key?: string,
    @Query('exp') exp?: string,
    @Query('sz') sz?: string,
    @Query('sig') sig?: string,
  ): Promise<void> {
    return this.upload(req, res, key, exp, sz, sig);
  }

  @Put('upload')
  putUpload(
    @Req() req: Request,
    @Res() res: Response,
    @Query('key') key?: string,
    @Query('exp') exp?: string,
    @Query('sz') sz?: string,
    @Query('sig') sig?: string,
  ): Promise<void> {
    return this.upload(req, res, key, exp, sz, sig);
  }

  private async upload(
    req: Request,
    res: Response,
    key?: string,
    exp?: string,
    sz?: string,
    sig?: string,
  ): Promise<void> {
    if (!(this.storage instanceof LocalFsStorage)) {
      throw new NotFoundException();
    }
    if (!key || !exp || !sz || !sig) {
      throw new BadRequestException('missing signed-url params');
    }
    const expMs = Number(exp);
    const sizeBytes = Number(sz);
    if (!Number.isFinite(expMs) || !Number.isFinite(sizeBytes)) {
      throw new BadRequestException('invalid signed-url params');
    }
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`upload exceeds ${MAX_UPLOAD_BYTES} bytes`);
    }
    if (!this.storage.verifyUploadSignature(key, expMs, sizeBytes, sig)) {
      throw new ForbiddenException('invalid or expired upload signature');
    }
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    if (body.length !== sizeBytes) {
      throw new BadRequestException(
        `upload size mismatch: got ${body.length} bytes, signature was for ${sizeBytes}`,
      );
    }
    await this.storage.writeDirect(key, body);
    res.status(204).end();
  }
}

async function readBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        rejectBody(new BadRequestException(`upload exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}
