import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@munin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { SuggestionsService, STATUSES } from '../modules/suggestions/suggestions.service.js';

const PatchDto = z.object({
  status: z.enum(STATUSES).optional(),
  public: z.boolean().optional(),
  duplicateOfId: z.string().nullable().optional(),
});

@Controller('api/suggestions')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class SuggestionsAdminController {
  constructor(@Inject(SuggestionsService) private readonly service: SuggestionsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('sort') sort?: string) {
    return this.service.list({
      status: status as never,
      sort: sort === 'recent' ? 'recent' : 'votes',
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown) {
    const parsed = PatchDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.public !== undefined) updates.public = parsed.data.public;
    if (parsed.data.duplicateOfId !== undefined) {
      updates.duplicateOfId = parsed.data.duplicateOfId;
      // Marking-as-duplicate also flips status for clarity.
      if (parsed.data.duplicateOfId) updates.status = 'duplicate';
    }

    const result = await ctx.db
      .update(schema.suggestions)
      .set(updates)
      .where(eq(schema.suggestions.id, id))
      .returning({ id: schema.suggestions.id });
    if (result.length === 0) throw new NotFoundException(`suggestion ${id} not found`);

    // Return the canonical DTO via the service (RLS guarantees it's this org's).
    void actor;
    return this.service.get(id);
  }
}
