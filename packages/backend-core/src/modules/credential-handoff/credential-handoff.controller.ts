import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CredentialHandoffService,
  type CredentialLink,
  type PendingCredentialDto,
} from './credential-handoff.service.ts';
import type { CredentialApplyResult } from './credential-target.ts';

const DescribeQuery = z.object({ token: z.string().min(1).max(128) });
const CompleteBody = z.object({
  token: z.string().min(1).max(128),
  secrets: z.record(z.string(), z.string().min(1)),
});

/**
 * Public credential-handoff endpoints — no session. The one-time token in the
 * link is the authorization; a human opens it to enter an integration's
 * secrets in the dashboard instead of pasting them into an agent chat.
 */
@Controller('v1/credentials')
export class CredentialHandoffController {
  constructor(private readonly handoff: CredentialHandoffService) {}

  @Get()
  describe(@Query() query: unknown): Promise<PendingCredentialDto> {
    const parsed = DescribeQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.handoff.describe(parsed.data.token);
  }

  @Post()
  complete(@Body() body: unknown): Promise<CredentialApplyResult> {
    const parsed = CompleteBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.handoff.complete(parsed.data.token, parsed.data.secrets);
  }
}

export type { CredentialLink };
