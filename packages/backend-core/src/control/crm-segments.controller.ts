import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  CrmService,
  CrmInvalidError,
  type ContactDto,
  type SegmentDto,
} from '../modules/crm/crm.service.ts';

const FilterSchema = z.object({
  tagsAny: z.array(z.string().min(1).max(64)).max(32).optional(),
  tagsAll: z.array(z.string().min(1).max(64)).max(32).optional(),
  companyId: z.string().min(1).max(64).optional(),
  searchQuery: z.string().min(1).max(200).optional(),
  contactedSince: z.string().datetime().optional(),
});

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  filter: FilterSchema,
});

const UpdateBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    filter: FilterSchema.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'patch must contain at least one field' });

interface SegmentListResponse {
  items: SegmentDto[];
}

interface SegmentContactsResponse {
  items: ContactDto[];
}

@Controller('api/v1/crm/segments')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class CrmSegmentsController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  async list(): Promise<SegmentListResponse> {
    const items = await translate(() => this.crm.listSegments());
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<SegmentDto> {
    return translate(() => this.crm.getSegment(id));
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<SegmentDto> {
    const parsed = CreateBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() => this.crm.createSegment(parsed.data));
  }

  @Patch(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: unknown): Promise<SegmentDto> {
    const parsed = UpdateBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() =>
      this.crm.updateSegment({
        id,
        patch: {
          name: parsed.data.name,
          description: parsed.data.description,
          filter: parsed.data.filter,
        },
      }),
    );
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    return translate(() => this.crm.deleteSegment(id));
  }

  @Get(':id/contacts')
  async listContacts(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<SegmentContactsResponse> {
    const items = await translate(() =>
      this.crm.listContactsInSegment({ id, limit: parseLimit(limit) }),
    );
    return { items };
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CrmInvalidError) throw new BadRequestException(err.message);
    throw err;
  }
}

function parseLimit(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 500);
}
