import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import { IdentityService, type EndUserDto } from '../modules/identity/identity.service.ts';

const EndUserPatchDto = z.object({
  externalId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

class CreateEndUserBody extends createZodDto(EndUserPatchDto) {}

class LookupEndUserBody extends createZodDto(
  z
    .object({
      externalId: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .refine((v) => v.externalId || v.email || v.phone, {
      message: 'at least one of externalId, email, phone is required',
    }),
) {}

@Controller('v1/end-users')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class EndUsersController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Post('lookup')
  @HttpCode(200)
  async lookup(@Body() input: LookupEndUserBody): Promise<EndUserDto> {
    return this.identity.findOrCreate(input);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() input: CreateEndUserBody): Promise<EndUserDto> {
    return this.identity.findOrCreate(input);
  }

  @Get()
  @RequireRole('owner', 'admin')
  async list(@Query('limit') limit?: string): Promise<EndUserDto[]> {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    return this.identity.list(Number.isFinite(parsed) ? parsed : undefined);
  }

  @Post(':id/revoke-tokens')
  @HttpCode(200)
  @RequireRole('owner', 'admin')
  async revokeTokens(@Param('id') id: string): Promise<{ revoked: number }> {
    return this.identity.revokeTokens(id);
  }

  @Get(':id')
  @RequireRole('owner', 'admin')
  async get(@Param('id') id: string): Promise<EndUserDto> {
    return this.identity.get(id);
  }
}
