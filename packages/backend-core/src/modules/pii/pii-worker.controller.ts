import { Body, HttpCode, Post, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PublicController } from '../../common/auth/auth.guard.ts';
import { PiiWorkerGuard } from './pii-worker.guard.ts';
import {
  PII_MAX_SURFACE_LENGTH,
  PiiAnnotationsService,
  type ClaimedMessage,
  type SubmitAnnotationsResult,
} from './pii-annotations.service.ts';

const DetectorVersion = z.number().int().min(1).max(1_000_000);
const Holder = z.string().min(1).max(128);

class ClaimBody extends createZodDto(
  z.object({
    detectorVersion: DetectorVersion,
    limit: z.number().int().min(1).max(200).default(50),
    leaseSeconds: z.number().int().min(30).max(3600).default(600),
    holder: Holder,
  }),
) {}

class SubmitBody extends createZodDto(
  z.object({
    holder: Holder,
    detectorVersion: DetectorVersion,
    detector: z.string().min(1).max(128),
    results: z
      .array(
        z.object({
          messageId: z.string().min(1).max(64),
          spans: z
            .array(
              z.object({
                start: z.number().int().min(0),
                end: z.number().int().min(1),
                text: z.string().min(1).max(PII_MAX_SURFACE_LENGTH),
                label: z.enum(['person', 'PER', 'per']).default('person'),
                source: z.string().min(1).max(32),
              }),
            )
            .max(1000),
        }),
      )
      .max(200),
  }),
) {}

@PublicController('v1/pii/annotations')
@UseGuards(PiiWorkerGuard)
export class PiiWorkerController {
  constructor(private readonly annotations: PiiAnnotationsService) {}

  @Post('claim')
  @HttpCode(200)
  claim(@Body() body: ClaimBody): Promise<{ items: ClaimedMessage[] }> {
    return this.annotations.claim(body);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@Body() body: SubmitBody): Promise<SubmitAnnotationsResult> {
    return this.annotations.submit(body);
  }
}
